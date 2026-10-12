const bcrypt = require("bcrypt");
const Booking = require("../models/Booking");
const Event = require("../models/event");
const User = require("../models/User");
const Venue = require("../models/Venue");
const logActivity = require("../utils/logActivity");
const createNotification = require("../utils/createNotification");

const getOwnedEvents = (organizerId) => Event.find({ organizer: organizerId }).sort({ createdAt: -1 }).lean();

const getOrganizerDashboard = async (req, res) => {
  try {
    const events = await getOwnedEvents(req.user.id);
    const eventIds = events.map((event) => event._id);
    const bookings = await Booking.find({ event: { $in: eventIds } })
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .populate("event", "name date time venue status")
      .lean();
    const today = new Date();
    const getEventDate = (event) => new Date(event.date);
    const isUpcoming = (event) => !Number.isNaN(getEventDate(event).getTime()) && getEventDate(event) >= today;
    const approvedEvents = events.filter((event) => (event.status || "approved") === "approved");
    const allUpcomingEvents = approvedEvents.filter(isUpcoming).sort((a, b) => getEventDate(a) - getEventDate(b));
    const upcomingEvents = allUpcomingEvents.slice(0, 6);
    const completedEvents = events.filter((event) => event.status === "completed" || ((event.status || "approved") === "approved" && !Number.isNaN(getEventDate(event).getTime()) && !isUpcoming(event)));
    const activeBookings = bookings.filter((booking) => booking.status !== "cancelled");
    const monthly = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1);
      return { key: `${date.getFullYear()}-${date.getMonth()}`, month: date.toLocaleString("en", { month: "short" }), bookings: 0, attendees: 0, revenue: 0 };
    });
    activeBookings.forEach((booking) => {
      const date = new Date(booking.createdAt);
      const month = monthly.find((item) => item.key === `${date.getFullYear()}-${date.getMonth()}`);
      if (month) {
        month.bookings += 1;
        month.attendees += booking.tickets;
        if (booking.status === "confirmed") month.revenue += booking.totalAmount || 0;
      }
    });

    const performanceByEvent = new Map();
    activeBookings.forEach((booking) => {
      const eventId = String(booking.event?._id || booking.event);
      const totals = performanceByEvent.get(eventId) || { bookings: 0, attendees: 0, revenue: 0 };
      totals.bookings += 1;
      totals.attendees += booking.tickets;
      if (booking.status === "confirmed") totals.revenue += booking.totalAmount || 0;
      performanceByEvent.set(eventId, totals);
    });

    const eventPerformance = events.map((event) => ({
      ...event,
      ...(performanceByEvent.get(String(event._id)) || { bookings: 0, attendees: 0, revenue: 0 }),
      displayStatus: event.status === "approved" && !isUpcoming(event) ? "completed" : event.status || "approved",
    })).sort((a, b) => b.bookings - a.bookings);

    res.json({
      stats: {
        totalEvents: events.length,
        upcomingEvents: allUpcomingEvents.length,
        completedEvents: completedEvents.length,
        totalBookings: bookings.length,
        totalAttendees: activeBookings.reduce((total, booking) => total + booking.tickets, 0),
        pendingEvents: events.filter((event) => event.status === "pending").length,
        totalRevenue: activeBookings.reduce((total, booking) => total + (booking.status === "confirmed" ? booking.totalAmount || 0 : 0), 0),
      },
      recentBookings: bookings.slice(0, 6),
      recentEvents: events.slice(0, 6),
      upcomingEvents,
      monthly,
      eventPerformance,
    });
  } catch (error) {
    console.error("Failed to load organizer dashboard:", error);
    res.status(500).json({ message: "Failed to load organizer dashboard" });
  }
};

const getOrganizerBookings = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).select("_id");
    const bookings = await Booking.find({ event: { $in: events.map((event) => event._id) } })
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .populate("event", "name date time venue status")
      .lean();
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: "Failed to load organizer bookings" });
  }
};

const getOrganizerAttendees = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).select("_id");
    const attendees = await Booking.find({ event: { $in: events.map((event) => event._id) }, status: { $ne: "cancelled" } })
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .populate("event", "name date")
      .lean();
    res.json(attendees);
  } catch (error) {
    res.status(500).json({ message: "Failed to load attendees" });
  }
};

const updateAttendanceStatus = async (req, res) => {
  try {
    const { attendanceStatus } = req.body;
    if (!["registered", "attended", "not-attended"].includes(attendanceStatus)) {
      return res.status(400).json({ message: "Invalid attendance status" });
    }
    const events = await Event.find({ organizer: req.user.id }).select("_id");
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.bookingId, event: { $in: events.map((event) => event._id) }, status: { $ne: "cancelled" } },
      { attendanceStatus },
      { new: true, runValidators: true }
    );
    if (!booking) return res.status(404).json({ message: "Attendee booking not found" });
    await logActivity({ actor: req.user.id, actorName: req.user.name || "Organizer", action: "attendee.status_updated", description: `Updated attendance for booking ${booking._id} to ${attendanceStatus}`, subjectType: "booking", subjectId: booking._id });
    await createNotification({
      title: "Attendance updated",
      message: `Your attendance status is now ${attendanceStatus}.`,
      audience: "users",
      recipient: booking.user,
      type: "booking",
      createdBy: req.user.id,
    });
    res.json(booking);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update attendance status" });
  }
};

const updateOrganizerBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["confirmed", "pending", "cancelled"].includes(status)) return res.status(400).json({ message: "Invalid booking status" });
    const events = await Event.find({ organizer: req.user.id }).select("_id");
    const booking = await Booking.findOne({ _id: req.params.bookingId, event: { $in: events.map((event) => event._id) } });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

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
    await logActivity({ actor: req.user.id, actorName: "Organizer", action: `booking.${status}`, description: `Set booking ${booking._id} to ${status}`, subjectType: "booking", subjectId: booking._id });
    res.json(booking);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update booking status" });
  }
};

const getOrganizerUsers = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).select("_id name date").lean();
    const bookings = await Booking.find({ event: { $in: events.map((event) => event._id) } })
      .populate("user", "name email isActive createdAt")
      .populate("event", "name date")
      .sort({ createdAt: -1 })
      .lean();
    const users = new Map();
    bookings.forEach((booking) => {
      if (!booking.user) return;
      const userId = String(booking.user._id);
      const user = users.get(userId) || { ...booking.user, bookingCount: 0, events: [], bookings: [] };
      user.bookingCount += 1;
      user.bookings.push(booking);
      if (booking.event && !user.events.some((event) => String(event._id) === String(booking.event._id))) {
        user.events.push(booking.event);
      }
      users.set(userId, user);
    });
    const search = String(req.query.search || "").trim().toLowerCase();
    const results = [...users.values()].filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(search));
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: "Failed to load event-related users" });
  }
};

const getOrganizerUserDetails = async (req, res) => {
  try {
    const events = await Event.find({ organizer: req.user.id }).select("_id");
    const bookings = await Booking.find({ user: req.params.userId, event: { $in: events.map((event) => event._id) } })
      .sort({ createdAt: -1 })
      .populate("event", "name date time venue status")
      .populate("user", "name email createdAt")
      .lean();
    if (!bookings.length) return res.status(404).json({ message: "No relationship with this user was found" });
    res.json({ user: bookings[0].user, bookings });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to load related user details" });
  }
};

const getOrganizerVenueAvailability = async (req, res) => {
  try {
    const { name, date, time } = req.query;
    if (!name || !date || !time) return res.status(400).json({ message: "Venue, date, and time are required" });
    const venue = await Venue.findOne({ name: String(name).trim(), isActive: true });
    if (!venue) return res.status(404).json({ message: "Venue is not available" });
    const scheduledEvents = await Event.find({ venue: venue.name, status: { $ne: "rejected" } }).select("name date time status").lean();
    const normalizeDate = (value) => {
      const parsedDate = new Date(value);
      return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toISOString().slice(0, 10);
    };
    const normalizeTime = (value) => {
      const match = String(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return String(value).trim().padStart(5, "0");
      let hour = Number(match[1]) % 12;
      if (match[3].toUpperCase() === "PM") hour += 12;
      return `${String(hour).padStart(2, "0")}:${match[2]}`;
    };
    const conflicts = scheduledEvents.filter((event) => normalizeDate(event.date) === date && normalizeTime(event.time) === normalizeTime(time));
    res.json({ available: conflicts.length === 0, conflicts });
  } catch (error) {
    res.status(500).json({ message: "Failed to check venue availability" });
  }
};

const getOrganizerVenues = async (req, res) => {
  try {
    const venues = await Venue.find({ isActive: true }).sort({ name: 1 }).lean();
    const events = await Event.find({ organizer: req.user.id }).select("name venue date time status").lean();
    res.json(venues.map((venue) => ({
      ...venue,
      assignedEvents: events.filter((event) => event.venue === venue.name),
    })));
  } catch (error) {
    res.status(500).json({ message: "Failed to load venues" });
  }
};

const getOrganizerProfile = async (req, res) => {
  try {
    const organizer = await User.findOne({ _id: req.user.id, role: "organizer" }).select("name email phoneNumber organizationName organizerType profileImage organizerSettings createdAt");
    if (!organizer) return res.status(404).json({ message: "Organizer profile not found" });
    res.json(organizer);
  } catch (error) {
    res.status(500).json({ message: "Failed to load organizer profile" });
  }
};

const updateOrganizerProfile = async (req, res) => {
  try {
    const allowed = ["name", "email", "phoneNumber", "organizationName", "profileImage"];
    const updates = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, key === "email" ? String(req.body[key]).trim().toLowerCase() : req.body[key]]));
    const organizer = await User.findOneAndUpdate({ _id: req.user.id, role: "organizer" }, updates, { new: true, runValidators: true })
      .select("name email phoneNumber organizationName organizerType profileImage organizerSettings createdAt");
    if (!organizer) return res.status(404).json({ message: "Organizer profile not found" });
    res.json(organizer);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.name === "ValidationError" ? 400 : 500).json({ message: error.code === 11000 ? "Email is already in use" : error.message || "Failed to update organizer profile" });
  }
};

const getOrganizerSettings = async (req, res) => {
  try {
    const organizer = await User.findOne({ _id: req.user.id, role: "organizer" }).select("organizerSettings");
    if (!organizer) return res.status(404).json({ message: "Organizer account not found" });
    res.json(organizer.organizerSettings || {});
  } catch (error) {
    res.status(500).json({ message: "Failed to load organizer settings" });
  }
};

const updateOrganizerSettings = async (req, res) => {
  try {
    const allowed = ["notificationsEnabled", "bookingAlerts", "eventApprovalAlerts"];
    const settings = Object.fromEntries(allowed.filter((key) => typeof req.body[key] === "boolean").map((key) => [key, req.body[key]]));
    const organizer = await User.findOneAndUpdate({ _id: req.user.id, role: "organizer" }, { organizerSettings: settings }, { new: true })
      .select("organizerSettings");
    if (!organizer) return res.status(404).json({ message: "Organizer account not found" });
    res.json(organizer.organizerSettings);
  } catch (error) {
    res.status(500).json({ message: "Failed to update organizer settings" });
  }
};

const changeOrganizerPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const organizer = await User.findOne({ _id: req.user.id, role: "organizer" });
    if (!organizer) return res.status(404).json({ message: "Organizer account not found" });
    if (!currentPassword || !newPassword || newPassword.length < 8) return res.status(400).json({ message: "Enter the current password and a new password of at least 8 characters" });
    if (!(await bcrypt.compare(currentPassword, organizer.password))) return res.status(400).json({ message: "Current password is incorrect" });
    organizer.password = await bcrypt.hash(newPassword, 10);
    await organizer.save();
    res.json({ message: "Password updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update password" });
  }
};

module.exports = {
  getOrganizerDashboard,
  getOrganizerBookings,
  getOrganizerAttendees,
  updateAttendanceStatus,
  updateOrganizerBookingStatus,
  getOrganizerUsers,
  getOrganizerUserDetails,
  getOrganizerVenues,
  getOrganizerVenueAvailability,
  getOrganizerProfile,
  updateOrganizerProfile,
  getOrganizerSettings,
  updateOrganizerSettings,
  changeOrganizerPassword,
};