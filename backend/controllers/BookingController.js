const Booking = require("../models/Booking");
const Event = require("../models/event");
const PlatformSettings = require("../models/PlatformSettings");
const mongoose = require("mongoose");
const logActivity = require("../utils/logActivity");
const createNotification = require("../utils/createNotification");

const createBooking = async (req, res) => {
  try {
    const platformSettings = await PlatformSettings.findOne({ key: "platform" }).select("bookingsEnabled").lean();
    if (platformSettings?.bookingsEnabled === false) {
      return res.status(403).json({ message: "Bookings are temporarily disabled" });
    }

    const {
      event: eventId,
      tickets,
      customerName,
      customerEmail,
      customerPhone,
      organizationName,
      eventDetails,
    } = req.body;

    const normalizedEventId = String(eventId ?? "").trim();
    const sanitizedOrganizationName = String(organizationName || eventDetails?.organizationName || "").trim();

    if (
      !normalizedEventId ||
      !customerName?.trim() ||
      !customerEmail?.trim() ||
      !customerPhone?.trim() ||
      !sanitizedOrganizationName ||
      !Number.isInteger(tickets) ||
      tickets < 1
    ) {
      return res.status(400).json({
        message: "Please provide all booking details",
      });
    }

    let event;

    if (mongoose.Types.ObjectId.isValid(normalizedEventId)) {
      event = await Event.findOneAndUpdate(
        { _id: normalizedEventId, availableTickets: { $gte: tickets } },
        { $inc: { availableTickets: -tickets } },
        { new: true }
      );
    } else if (/^\d+$/.test(normalizedEventId)) {
      const legacyId = Number(normalizedEventId);

      event = await Event.findOneAndUpdate(
        { legacyId, availableTickets: { $gte: tickets } },
        { $inc: { availableTickets: -tickets } },
        { new: true }
      );

      if (!event && eventDetails && tickets <= 100) {
        event = await Event.create({
          legacyId,
          organizer: req.user.id,
          name: (eventDetails.name || "Event").trim(),
          type: eventDetails.type || "college",
          category: eventDetails.category || "General",
          date: eventDetails.date || new Date().toISOString(),
          time: eventDetails.time || "TBD",
          venue: eventDetails.venue || "TBD",
          price: Number(eventDetails.price) || 0,
          image: eventDetails.image || "",
          description: eventDetails.description || "",
          organizationName: sanitizedOrganizationName,
          availableTickets: 100 - tickets,
        });
      }
    }

    if (!event) {
      return res.status(400).json({ message: "Event not found or not enough tickets" });
    }

    const booking = await Booking.create({
      user: req.user.id,
      event: event._id,
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      organizationName: sanitizedOrganizationName,
      tickets,
      totalAmount: Number(event.price || 0) * tickets,
    });

    await logActivity({
      actor: req.user.id,
      actorName: customerName.trim(),
      action: "booking.created",
      description: `${customerName.trim()} booked ${event.name}`,
      subjectType: "booking",
      subjectId: booking._id,
    });
    if (event.organizer) {
      await createNotification({
        title: "New event booking",
        message: `${customerName.trim()} booked ${tickets} ticket${tickets === 1 ? "" : "s"} for ${event.name}.`,
        audience: "organizers",
        recipient: event.organizer,
        type: "booking",
        createdBy: req.user.id,
      });
    }

    res.status(201).json({
      message: "Booking created successfully",
      bookingId: booking._id,
      booking,
    });
  } catch (error) {
    console.error(error);

    res.status(error.name === "CastError" || error.name === "ValidationError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid event ID" : error.name === "ValidationError" ? error.message : "Failed to create booking",
    });
  }
};
const getBookings = async (req, res) => {
  try {
    let filter = { user: req.user.id };

    if (req.user.role === "admin") {
      filter = {};
    } else if (req.user.role === "organizer") {
      const organizerEvents = await Event.find({ organizer: req.user.id }).select("_id");
      filter = { event: { $in: organizerEvents.map((event) => event._id) } };
    }

    const bookings = await Booking.find(filter)
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .populate({
        path: "event",
        select: "name type category date time venue price organizationName organizer",
        populate: { path: "organizer", select: "name email" },
      });

    res.status(200).json(bookings);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch bookings",
    });
  }
};

const getBookingById = async (req, res) => {
  try {
    const filter = req.user.role === "admin"
      ? { _id: req.params.id }
      : { _id: req.params.id, user: req.user.id };
    const booking = await Booking.findOne(filter)
      .populate("user", "name email")
      .populate("event");

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    res.status(200).json(booking);
  } catch (error) {
    console.error(error);

    res.status(error.name === "CastError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid booking ID" : "Failed to fetch booking",
    });
  }
};

const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["confirmed", "pending", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Status must be confirmed, pending, or cancelled" });
    }
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    const previousStatus = booking.status;

    if (booking.status !== "cancelled" && status === "cancelled") {
      await Event.findByIdAndUpdate(booking.event, { $inc: { availableTickets: booking.tickets } });
    } else if (booking.status === "cancelled" && status !== "cancelled") {
      const event = await Event.findOneAndUpdate(
        { _id: booking.event, availableTickets: { $gte: booking.tickets } },
        { $inc: { availableTickets: -booking.tickets } },
        { new: true }
      );
      if (!event) return res.status(409).json({ message: "Not enough tickets are available to restore this booking" });
    }

    booking.status = status;
    await booking.save();
    await logActivity({ actor: req.user.id, actorName: "Admin", action: `booking.${status}`, description: `Set booking ${booking._id} to ${status}`, subjectType: "booking", subjectId: booking._id });
    if (previousStatus !== status) {
      const event = await Event.findById(booking.event).select("name organizer").lean();
      await createNotification({
        title: status === "cancelled" ? "Booking cancelled" : "Booking status updated",
        message: `Your booking for ${event?.name || "an event"} is now ${status}.`,
        audience: "users",
        recipient: booking.user,
        type: "booking",
        createdBy: req.user.id,
      });
      if (status === "cancelled" && event?.organizer) {
        await createNotification({
          title: "Booking cancelled",
          message: `A booking for ${event.name} was cancelled.`,
          audience: "organizers",
          recipient: event.organizer,
          type: "booking",
          createdBy: req.user.id,
        });
      }
    }
    res.json(booking);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update booking status" });
  }
};

const deleteBooking = async (req, res) => {
  try {
    const filter = req.user.role === "admin"
      ? { _id: req.params.id, status: { $in: ["confirmed", "pending"] } }
      : { _id: req.params.id, user: req.user.id, status: { $in: ["confirmed", "pending"] } };
    const booking = await Booking.findOneAndUpdate(
      filter,
      { status: "cancelled" },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    await Event.findByIdAndUpdate(booking.event, {
      $inc: { availableTickets: booking.tickets },
    });

    await logActivity({
      actor: req.user.id,
      actorName: req.user.name || req.user.role,
      action: "booking.cancelled",
      description: `Cancelled booking ${booking._id}`,
      subjectType: "booking",
      subjectId: booking._id,
    });

    const event = await Event.findById(booking.event).select("name organizer").lean();
    if (event?.organizer && req.user.role !== "organizer") {
      await createNotification({
        title: "Booking cancelled",
        message: `A booking for ${event.name} was cancelled.`,
        audience: "organizers",
        recipient: event.organizer,
        type: "booking",
        createdBy: req.user.id,
      });
    }

    res.status(200).json({
      message: "Booking cancelled successfully",
    });
  } catch (error) {
    console.error(error);

    res.status(error.name === "CastError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid booking ID" : "Failed to cancel booking",
    });
  }
};

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  updateBookingStatus,
  deleteBooking,
};