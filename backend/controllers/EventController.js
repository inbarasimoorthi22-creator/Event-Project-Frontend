const Event = require("../models/event");
const Booking = require("../models/Booking");
const PlatformSettings = require("../models/PlatformSettings");
const Category = require("../models/Category");
const createNotification = require("../utils/createNotification");
const logActivity = require("../utils/logActivity");

const createEvent = async (req, res) => {
  try {
    const eventType = req.user.role === "organizer"
      ? req.user.organizerType
      : req.body.type;

    if (!eventType) {
      return res.status(400).json({
        message: "Organizer category is not configured",
      });
    }

    if (req.user.role === "organizer" && req.body.type && req.body.type !== eventType) {
      return res.status(403).json({
        message: `This organizer can only create ${eventType} events`,
      });
    }

    const settings = await PlatformSettings.findOne({ key: "platform" }).select("eventsRequireApproval").lean();
    const status = req.user.role === "admin"
      ? "approved"
      : req.body.status === "draft"
        ? "draft"
        : settings?.eventsRequireApproval === false
          ? "approved"
          : "pending";
    if (status !== "draft" && ["name", "category", "date", "time", "venue"].some((field) => !String(req.body[field] || "").trim())) {
      return res.status(400).json({ message: "Complete all event details before submitting for approval" });
    }
    const event = await Event.create({
      ...req.body,
      type: eventType,
      organizer: req.user.id,
      organizationName: req.user.organizationName || "",
      status,
    });

    await logActivity({
      actor: req.user.id,
      actorName: req.user.name || req.user.role,
      action: "event.created",
      description: `${event.name} was created${status === "pending" ? " and is awaiting approval" : ""}`,
      subjectType: "event",
      subjectId: event._id,
    });

    res.status(201).json({
      message: "Event created successfully",
      event,
    });
  } catch (error) {
    console.error(error);
    res.status(error.name === "ValidationError" ? 400 : 500).json({
      message: error.name === "ValidationError" ? error.message : "Failed to create event",
    });
  }
};

const getEvents = async (req, res) => {
  try {
    const events = await Event.find({
      $or: [{ status: "approved" }, { status: { $exists: false } }],
    });

    res.status(200).json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch events",
    });
  }
};

const getEventCategories = async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.type) filter.type = req.query.type;
    res.json(await Category.find(filter).sort({ name: 1 }).select("name type description").lean());
  } catch (error) {
    res.status(500).json({ message: "Failed to load event categories" });
  }
};

const getAdminEvents = async (req, res) => {
  try {
    const events = await Event.find()
      .sort({ createdAt: -1 })
      .populate("organizer", "name email organizationName")
      .lean();
    res.json(events.map((event) => ({ ...event, status: event.status || "approved" })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch events" });
  }
};

const getOrganizerEvents = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id });
    res.status(200).json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch organizer events",
    });
  }
};

const getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    const isPublic = event.status === "approved" || event.status === undefined;
    const canViewPrivate = req.user?.role === "admin" || (
      req.user?.role === "organizer" && String(event.organizer) === String(req.user.id)
    );
    if (!isPublic && !canViewPrivate) {
      return res.status(404).json({ message: "Event not found" });
    }

    res.status(200).json(event);
  } catch (error) {
    console.error(error);
    res.status(error.name === "CastError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid event ID" : "Failed to fetch event",
    });
  }
};

const updateEvent = async (req, res) => {
  try {
    const { organizer, status, ...updates } = req.body;
    const filter = req.user.role === "admin"
      ? { _id: req.params.id }
      : { _id: req.params.id, organizer: req.user.id };
    const event = await Event.findOneAndUpdate(
      filter,
      updates,
      { new: true, runValidators: true }
    );

    if (!event) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    await logActivity({ actor: req.user.id, actorName: req.user.name || req.user.role, action: "event.updated", description: `Updated ${event.name}`, subjectType: "event", subjectId: event._id });

    res.status(200).json({
      message: "Event updated successfully",
      event,
    });
  } catch (error) {
    console.error(error);
    res.status(error.name === "ValidationError" || error.name === "CastError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid event ID" : error.name === "ValidationError" ? error.message : "Failed to update event",
    });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const filter = req.user.role === "admin"
      ? { _id: req.params.id }
      : { _id: req.params.id, organizer: req.user.id };
    const event = await Event.findOne(filter);

    if (!event) {
      return res.status(404).json({
        message: "Event not found",
      });
    }

    if (await Booking.exists({ event: event._id })) {
      return res.status(409).json({ message: "This event has booking history and cannot be deleted" });
    }

    await event.deleteOne();
    await logActivity({ actor: req.user.id, actorName: req.user.name || req.user.role, action: "event.deleted", description: `Deleted ${event.name}`, subjectType: "event", subjectId: event._id });

    res.status(200).json({
      message: "Event deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(error.name === "CastError" ? 400 : 500).json({
      message: error.name === "CastError" ? "Invalid event ID" : "Failed to delete event",
    });
  }
};

const submitEventForApproval = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, organizer: req.user.id });
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.status !== "draft") return res.status(409).json({ message: "Only draft events can be submitted" });
    if ([event.name, event.category, event.date, event.time, event.venue].some((value) => !String(value || "").trim())) {
      return res.status(400).json({ message: "Complete all event details before submitting for approval" });
    }
    const settings = await PlatformSettings.findOne({ key: "platform" }).select("eventsRequireApproval").lean();
    event.status = settings?.eventsRequireApproval === false ? "approved" : "pending";
    await event.save();
    await logActivity({ actor: req.user.id, actorName: req.user.name || "Organizer", action: "event.submitted", description: `Submitted ${event.name} for approval`, subjectType: "event", subjectId: event._id });
    res.json(event);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to submit event" });
  }
};

const updateEventStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["draft", "pending", "approved", "rejected", "completed"].includes(status)) {
      return res.status(400).json({ message: "Invalid event status" });
    }
    const event = await Event.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!event) return res.status(404).json({ message: "Event not found" });
    await logActivity({ actor: req.user.id, actorName: "Admin", action: `event.${status}`, description: `${status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Reopened"} ${event.name}`, subjectType: "event", subjectId: event._id });
    if (["approved", "rejected"].includes(status)) {
      await createNotification({
        title: status === "approved" ? "Event approved" : "Event not approved",
        message: `${event.name} was ${status === "approved" ? "approved and is now visible" : "rejected by an administrator"}.`,
        audience: "organizers",
        recipient: event.organizer,
        type: "event",
        createdBy: req.user.id,
      });
    }
    res.json(event);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update event status" });
  }
};

module.exports = {
  createEvent,
  getEvents,
  getEventCategories,
  getAdminEvents,
  getOrganizerEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  submitEventForApproval,
  updateEventStatus,
};