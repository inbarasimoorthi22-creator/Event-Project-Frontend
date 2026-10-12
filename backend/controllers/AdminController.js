const bcrypt = require("bcrypt");
const ActivityLog = require("../models/ActivityLog");
const AdminNotification = require("../models/AdminNotification");
const Booking = require("../models/Booking");
const Category = require("../models/Category");
const Event = require("../models/event");
const PlatformSettings = require("../models/PlatformSettings");
const User = require("../models/User");
const Venue = require("../models/Venue");
const logActivity = require("../utils/logActivity");

const getDashboard = async (req, res) => {
  try {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    const [
      totalUsers,
      totalOrganizers,
      totalEvents,
      pendingEventsCount,
      approvedEventsCount,
      totalBookings,
      bookingTotals,
      monthlyBookings,
      recentBookings,
      recentEvents,
      pendingEvents,
      allEvents,
    ] = await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "organizer" }),
      Event.countDocuments(),
      Event.countDocuments({ status: "pending" }),
      Event.countDocuments({ $or: [{ status: "approved" }, { status: { $exists: false } }] }),
      Booking.countDocuments(),
      Booking.aggregate([
        { $match: { status: { $ne: "cancelled" } } },
        { $group: { _id: null, revenue: { $sum: "$totalAmount" } } },
      ]),
      Booking.find({ createdAt: { $gte: monthStart }, status: { $ne: "cancelled" } })
        .select("createdAt totalAmount")
        .lean(),
      Booking.find()
        .sort({ createdAt: -1 })
        .limit(6)
        .populate("user", "name email")
        .populate("event", "name type organizationName organizer")
        .lean(),
      Event.find().sort({ createdAt: -1 }).limit(6).populate("organizer", "name").lean(),
      Event.find({ status: "pending" }).sort({ createdAt: 1 }).limit(6).populate("organizer", "name").lean(),
      Event.find({ $or: [{ status: "approved" }, { status: { $exists: false } }] }).lean(),
    ]);

    const upcomingEvents = allEvents
      .map((event) => ({ ...event, parsedDate: new Date(event.date) }))
      .filter((event) => !Number.isNaN(event.parsedDate.getTime()) && event.parsedDate >= today)
      .sort((first, second) => first.parsedDate - second.parsedDate)
      .slice(0, 6)
      .map(({ parsedDate, ...event }) => event);

    const monthSeries = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth() - 5 + index, 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: date.toLocaleString("en", { month: "short" }),
        bookings: 0,
        revenue: 0,
      };
    });

    monthlyBookings.forEach((booking) => {
      const date = new Date(booking.createdAt);
      const bucket = monthSeries.find(
        (month) => month.key === `${date.getFullYear()}-${date.getMonth()}`
      );
      if (bucket) {
        bucket.bookings += 1;
        bucket.revenue += booking.totalAmount || 0;
      }
    });

    res.json({
      stats: {
        totalUsers,
        totalOrganizers,
        totalEvents,
        totalBookings,
        pendingEvents: pendingEventsCount,
        approvedEvents: approvedEventsCount,
        totalRevenue: bookingTotals[0]?.revenue || 0,
      },
      recentBookings,
      recentEvents,
      pendingEvents,
      upcomingEvents,
      monthly: monthSeries,
    });
  } catch (error) {
    console.error("Failed to load admin dashboard:", error);
    res.status(500).json({ message: "Failed to load dashboard data" });
  }
};

const getReports = async (req, res) => {
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - 11, 1);
    const [users, organizers, events, bookings] = await Promise.all([
      User.find({ role: "user" }).select("createdAt").lean(),
      User.find({ role: "organizer" }).select("createdAt isActive").lean(),
      Event.find().select("name category type status date price").lean(),
      Booking.find({ status: { $ne: "cancelled" } })
        .select("event tickets totalAmount createdAt")
        .populate("event", "name category type")
        .lean(),
    ]);

    const monthSeries = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(since.getFullYear(), since.getMonth() + index, 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}`,
        month: date.toLocaleString("en", { month: "short" }),
        bookings: 0,
        revenue: 0,
        registrations: 0,
      };
    });

    const findMonth = (dateValue) => {
      const date = new Date(dateValue);
      return monthSeries.find((month) => month.key === `${date.getFullYear()}-${date.getMonth()}`);
    };

    bookings.forEach((booking) => {
      const month = findMonth(booking.createdAt);
      if (month) {
        month.bookings += 1;
        month.revenue += booking.totalAmount || 0;
      }
    });
    users.forEach((user) => {
      const month = findMonth(user.createdAt);
      if (month) month.registrations += 1;
    });

    const popularEvents = new Map();
    const popularCategories = new Map();
    bookings.forEach((booking) => {
      const event = booking.event;
      if (!event) return;
      const eventTotals = popularEvents.get(String(event._id)) || { name: event.name, bookings: 0, revenue: 0 };
      eventTotals.bookings += 1;
      eventTotals.revenue += booking.totalAmount || 0;
      popularEvents.set(String(event._id), eventTotals);
      const category = event.category || "Uncategorized";
      popularCategories.set(category, (popularCategories.get(category) || 0) + booking.tickets);
    });

    const eventPerformance = events
      .map((event) => {
        const totals = popularEvents.get(String(event._id));
        return { ...event, bookings: totals?.bookings || 0, revenue: totals?.revenue || 0 };
      })
      .sort((first, second) => second.bookings - first.bookings)
      .slice(0, 8);

    res.json({
      totals: {
        users: users.length,
        organizers: organizers.filter((organizer) => organizer.isActive !== false && organizer.organizerApprovalStatus !== "rejected").length,
        events: events.length,
        bookings: bookings.length,
        revenue: bookings.reduce((total, booking) => total + (booking.totalAmount || 0), 0),
      },
      monthly: monthSeries,
      popularEvents: [...popularEvents.values()].sort((a, b) => b.bookings - a.bookings).slice(0, 6),
      popularCategories: [...popularCategories.entries()]
        .map(([name, tickets]) => ({ name, tickets }))
        .sort((a, b) => b.tickets - a.tickets)
        .slice(0, 7),
      eventPerformance,
    });
  } catch (error) {
    console.error("Failed to load reports:", error);
    res.status(500).json({ message: "Failed to load reports" });
  }
};

const getOrganizers = async (req, res) => {
  try {
    const organizers = await User.find({ role: "organizer" })
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();
    const organizerIds = organizers.map((organizer) => organizer._id);
    const [eventCounts, bookingCounts] = await Promise.all([
      Event.aggregate([{ $match: { organizer: { $in: organizerIds } } }, { $group: { _id: "$organizer", total: { $sum: 1 } } }]),
      Booking.aggregate([
        { $lookup: { from: "events", localField: "event", foreignField: "_id", as: "event" } },
        { $unwind: "$event" },
        { $match: { "event.organizer": { $in: organizerIds } } },
        { $group: { _id: "$event.organizer", total: { $sum: 1 } } },
      ]),
    ]);
    const eventsByOrganizer = new Map(eventCounts.map((item) => [String(item._id), item.total]));
    const bookingsByOrganizer = new Map(bookingCounts.map((item) => [String(item._id), item.total]));
    res.json(organizers.map((organizer) => ({
      ...organizer,
      eventCount: eventsByOrganizer.get(String(organizer._id)) || 0,
      bookingCount: bookingsByOrganizer.get(String(organizer._id)) || 0,
    })));
  } catch (error) {
    console.error("Failed to load organizers:", error);
    res.status(500).json({ message: "Failed to load organizers" });
  }
};

const getOrganizerDetails = async (req, res) => {
  try {
    const organizer = await User.findOne({ _id: req.params.id, role: "organizer" }).select("-password").lean();
    if (!organizer) return res.status(404).json({ message: "Organizer not found" });
    const events = await Event.find({ organizer: organizer._id }).sort({ createdAt: -1 }).lean();
    const bookings = await Booking.find({ event: { $in: events.map((event) => event._id) } })
      .sort({ createdAt: -1 })
      .populate("user", "name email")
      .populate("event", "name date")
      .lean();
    res.json({ ...organizer, events, bookings });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to load organizer details" });
  }
};

const getVenueAvailability = async (req, res) => {
  try {
    const { name, date, time } = req.query;
    if (!name || !date || !time) return res.status(400).json({ message: "Venue, date, and time are required" });
    const scheduledEvents = await Event.find({ venue: name.trim(), status: { $ne: "rejected" } })
      .select("name date time status")
      .lean();
    const normalizeDate = (value) => {
      const parsedDate = new Date(value);
      return Number.isNaN(parsedDate.getTime()) ? value : parsedDate.toISOString().slice(0, 10);
    };
    const normalizeTime = (value) => {
      const meridiemTime = String(value).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!meridiemTime) return String(value).trim().padStart(5, "0");
      let hour = Number(meridiemTime[1]) % 12;
      if (meridiemTime[3].toUpperCase() === "PM") hour += 12;
      return `${String(hour).padStart(2, "0")}:${meridiemTime[2]}`;
    };
    const conflicts = scheduledEvents.filter((event) => normalizeDate(event.date) === date && normalizeTime(event.time) === normalizeTime(time));
    res.json({ available: conflicts.length === 0, conflicts });
  } catch (error) {
    res.status(500).json({ message: "Failed to check venue availability" });
  }
};

const getVenues = async (req, res) => {
  try {
    const [venues, events] = await Promise.all([
      Venue.find().sort({ name: 1 }).lean(),
      Event.find().select("name venue date time status").lean(),
    ]);
    res.json(venues.map((venue) => {
      const assignedEventList = events.filter((event) => event.venue === venue.name);
      return { ...venue, assignedEvents: assignedEventList.length, assignedEventList };
    }));
  } catch (error) {
    console.error("Failed to load venues:", error);
    res.status(500).json({ message: "Failed to load venues" });
  }
};

const saveVenue = async (req, res) => {
  try {
    const { name, location, capacity, description } = req.body;
    const existingVenue = req.params.id ? await Venue.findById(req.params.id) : null;
    const previousName = existingVenue?.name;
    const venue = req.params.id
      ? await Venue.findByIdAndUpdate(req.params.id, { name, location, capacity, description }, { new: true, runValidators: true })
      : await Venue.create({ name, location, capacity, description });
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    if (previousName && previousName !== venue.name) {
      await Event.updateMany({ venue: previousName }, { $set: { venue: venue.name } });
    }
    await logActivity({ actor: req.user.id, actorName: "Admin", action: req.params.id ? "venue.updated" : "venue.created", description: `${req.params.id ? "Updated" : "Added"} venue ${venue.name}`, subjectType: "venue", subjectId: venue._id });
    res.status(req.params.id ? 200 : 201).json(venue);
  } catch (error) {
    res.status(error.name === "ValidationError" || error.name === "CastError" ? 400 : 500).json({ message: error.message || "Failed to save venue" });
  }
};

const deleteVenue = async (req, res) => {
  try {
    const venue = await Venue.findById(req.params.id);
    if (!venue) return res.status(404).json({ message: "Venue not found" });
    const assignedEvents = await Event.countDocuments({ venue: venue.name });
    if (assignedEvents) return res.status(409).json({ message: "This venue is assigned to events and cannot be deleted" });
    await venue.deleteOne();
    res.json({ message: "Venue deleted" });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to delete venue" });
  }
};

const getCategories = async (req, res) => {
  try {
    res.json(await Category.find().sort({ type: 1, name: 1 }).lean());
  } catch (error) {
    res.status(500).json({ message: "Failed to load categories" });
  }
};

const saveCategory = async (req, res) => {
  try {
    const { name, type, description } = req.body;
    const existingCategory = req.params.id ? await Category.findById(req.params.id) : null;
    const category = req.params.id
      ? await Category.findByIdAndUpdate(req.params.id, { name, type, description }, { new: true, runValidators: true })
      : await Category.create({ name, type, description });
    if (!category) return res.status(404).json({ message: "Category not found" });
    if (existingCategory && (existingCategory.name !== category.name || existingCategory.type !== category.type)) {
      await Event.updateMany(
        { category: existingCategory.name, type: existingCategory.type },
        { $set: { category: category.name, type: category.type } }
      );
    }
    res.status(req.params.id ? 200 : 201).json(category);
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.name === "ValidationError" || error.name === "CastError" ? 400 : 500;
    res.status(status).json({ message: error.code === 11000 ? "This category already exists for the selected event type" : error.message || "Failed to save category" });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });
    const assignedEvents = await Event.countDocuments({ category: category.name, type: category.type });
    if (assignedEvents) return res.status(409).json({ message: "This category is assigned to events and cannot be deleted" });
    await category.deleteOne();
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to delete category" });
  }
};

const getNotifications = async (req, res) => {
  try {
    res.json(await AdminNotification.find().sort({ createdAt: -1 }).limit(100).populate("createdBy", "name email").lean());
  } catch (error) {
    res.status(500).json({ message: "Failed to load notifications" });
  }
};

const sendNotification = async (req, res) => {
  try {
    const { title, message, audience, type } = req.body;
    const settings = await PlatformSettings.findOne({ key: "platform" }).select("notificationsEnabled").lean();
    if (settings?.notificationsEnabled === false) {
      return res.status(403).json({ message: "Platform notifications are disabled" });
    }
    const notification = await AdminNotification.create({ title, message, audience, type, createdBy: req.user.id });
    await logActivity({ actor: req.user.id, actorName: "Admin", action: "notification.sent", description: `Sent ${type || "announcement"} notification to ${audience}`, subjectType: "notification", subjectId: notification._id });
    res.status(201).json(notification);
  } catch (error) {
    res.status(error.name === "ValidationError" ? 400 : 500).json({ message: error.message || "Failed to send notification" });
  }
};

const getActivityLogs = async (req, res) => {
  try {
    res.json(await ActivityLog.find().sort({ createdAt: -1 }).limit(100).lean());
  } catch (error) {
    res.status(500).json({ message: "Failed to load activity logs" });
  }
};

const getSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.findOneAndUpdate(
      { key: "platform" },
      { $setOnInsert: { key: "platform" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: "Failed to load settings" });
  }
};

const updateSettings = async (req, res) => {
  try {
    const allowedKeys = ["platformName", "supportEmail", "eventsRequireApproval", "bookingsEnabled", "notificationsEnabled", "maintenanceMode"];
    const updates = Object.fromEntries(allowedKeys.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));
    const settings = await PlatformSettings.findOneAndUpdate(
      { key: "platform" },
      { $set: updates, $setOnInsert: { key: "platform" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await logActivity({ actor: req.user.id, actorName: "Admin", action: "settings.updated", description: "Updated platform settings", subjectType: "settings" });
    res.json(settings);
  } catch (error) {
    res.status(error.name === "ValidationError" ? 400 : 500).json({ message: error.message || "Failed to update settings" });
  }
};

const getAdminProfile = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select("name email profileImage createdAt role");
    if (!admin || admin.role !== "admin") return res.status(404).json({ message: "Admin profile not found" });
    res.json(admin);
  } catch (error) {
    res.status(500).json({ message: "Failed to load admin profile" });
  }
};

const updateAdminProfile = async (req, res) => {
  try {
    const { name, email, profileImage } = req.body;
    const admin = await User.findOneAndUpdate(
      { _id: req.user.id, role: "admin" },
      { name, email: email?.trim().toLowerCase(), profileImage },
      { new: true, runValidators: true }
    ).select("name email profileImage createdAt");
    if (!admin) return res.status(404).json({ message: "Admin profile not found" });
    res.json(admin);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.name === "ValidationError" ? 400 : 500).json({ message: error.code === 11000 ? "Email is already in use" : error.message || "Failed to update profile" });
  }
};

const changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const admin = await User.findById(req.user.id);
    if (!admin || admin.role !== "admin") return res.status(404).json({ message: "Admin profile not found" });
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: "Enter the current password and a new password of at least 8 characters" });
    }
    if (!(await bcrypt.compare(currentPassword, admin.password))) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }
    admin.password = await bcrypt.hash(newPassword, 10);
    await admin.save();
    res.json({ message: "Password updated" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update password" });
  }
};

const updateOrganizerStatus = async (req, res) => {
  try {
    const updates = {};
    if (req.body.approvalStatus !== undefined) {
      if (!["pending", "approved", "rejected"].includes(req.body.approvalStatus)) {
        return res.status(400).json({ message: "Invalid organizer approval status" });
      }
      updates.organizerApprovalStatus = req.body.approvalStatus;
    }
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
      updates.isActive = req.body.isActive;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ message: "No organizer changes provided" });
    const organizer = await User.findOneAndUpdate(
      { _id: req.params.id, role: "organizer" },
      updates,
      { new: true, runValidators: true }
    ).select("-password");
    if (!organizer) return res.status(404).json({ message: "Organizer not found" });
    await logActivity({
      actor: req.user.id,
      actorName: "Admin",
      action: updates.organizerApprovalStatus ? `organizer.${updates.organizerApprovalStatus}` : `organizer.${updates.isActive ? "activated" : "deactivated"}`,
      description: `${updates.organizerApprovalStatus ? `${updates.organizerApprovalStatus} organizer` : `${updates.isActive ? "Activated" : "Deactivated"} organizer`} ${organizer.name}`,
      subjectType: "organizer",
      subjectId: organizer._id,
    });
    res.json(organizer);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update organizer" });
  }
};

module.exports = {
  getDashboard,
  getReports,
  getOrganizers,
  getOrganizerDetails,
  updateOrganizerStatus,
  getVenues,
  getVenueAvailability,
  saveVenue,
  deleteVenue,
  getCategories,
  saveCategory,
  deleteCategory,
  getNotifications,
  sendNotification,
  getActivityLogs,
  getSettings,
  updateSettings,
  getAdminProfile,
  updateAdminProfile,
  changeAdminPassword,
};