const User = require("../models/User");
const Booking = require("../models/Booking");
const Event = require("../models/event");
const AdminNotification = require("../models/AdminNotification");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const logActivity = require("../utils/logActivity");

const fixedAccounts = {
  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    name: "EventHub Admin",
  },
  organizer: {
    email: "inba22@gmail.com",
    password: "inbainba",
    name: "Excel Engineering College Organizer",
    organizerType: "college",
    organizationName: "Excel Engineering College",
  },
  privateOrganizer: {
    email: process.env.ORGANIZER_EMAIL,
    password: process.env.ORGANIZER_PASSWORD,
    name: "Private Event Organizer",
    organizerType: "private",
    organizationName: "Private Events",
  },
};

const getFixedAccount = async (accountKey) => {
  const account = fixedAccounts[accountKey];
  const role = "admin" === accountKey ? "admin" : "organizer";
  let user = await User.findOne({ email: account.email });
  if (!user) user = await User.findOne({ fixedAccountKey: accountKey });
  if (!user && role === "admin") user = await User.findOne({ role: "admin" });
  if (!user && role === "organizer") {
    user = await User.findOne({ role, organizerType: account.organizerType, organizationName: account.organizationName });
  }

  if (!user) {
    const hashedPassword = await bcrypt.hash(account.password, 10);
    user = await User.create({
      name: account.name,
      email: account.email,
      password: hashedPassword,
      role,
      fixedAccountKey: accountKey,
      isActive: true,
      organizerApprovalStatus: "approved",
      organizerType: account.organizerType,
      organizationName: account.organizationName,
    });
  } else if (
    user.role !== role ||
    (role === "organizer" &&
      (!user.organizerType || !user.organizationName))
  ) {
    user.role = role;
    user.fixedAccountKey = accountKey;
    if (role === "organizer") {
      user.organizerApprovalStatus = user.organizerApprovalStatus || "approved";
      user.organizerType = user.organizerType || account.organizerType;
      user.organizationName = user.organizationName || account.organizationName;
    }
    await user.save();
  } else if (!user.fixedAccountKey) {
    user.fixedAccountKey = accountKey;
    await user.save();
  }

  return user;
};

const registerUser = async (req, res) => {
  try {
    const { name, email, password, role, organizerType, organizationName } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Please fill all fields",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const reservedEmails = Object.values(fixedAccounts).map((account) => account.email);

    if (reservedEmails.includes(normalizedEmail)) {
      return res.status(400).json({
        message: "This email is reserved for a platform account",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: role === "organizer" ? "organizer" : "user",
      organizerType: role === "organizer" ? organizerType : undefined,
      organizationName: role === "organizer" ? organizationName : undefined,
      organizerApprovalStatus: role === "organizer" ? "pending" : undefined,
    });

    await logActivity({
      actor: user._id,
      actorName: user.name,
      action: "user.registered",
      description: `${user.name} registered as ${user.role}`,
      subjectType: "user",
      subjectId: user._id,
    });

    res.status(201).json({
      message: "Registration successful",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizerType: user.organizerType,
        organizationName: user.organizationName,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error",
    });
  }
};

const loginUser = async (req, res) => {
  try {
    const { email, password, identifier } = req.body;
    const submittedIdentifier = String(identifier ?? email ?? "").trim();

    if (typeof password !== "string" || !password || !submittedIdentifier) {
      return res.status(400).json({
        message: "Email or organizer ID and password are required",
      });
    }

    const normalizedIdentifier = submittedIdentifier.toLowerCase();

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured");
      return res.status(500).json({
        message: "Authentication is not configured on the server",
      });
    }

    const userByIdentifier = await User.findOne({
      $or: [
        { email: normalizedIdentifier },
        { organizerId: { $regex: `^${submittedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      ],
    });

    const fixedAccount = Object.entries(fixedAccounts).find(
      ([, account]) => account.email === normalizedIdentifier
    );

    if (fixedAccount) {
      const [accountKey, account] = fixedAccount;

      const user = await getFixedAccount(accountKey);
      const role = user.role;

      if (!(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      if (user.isActive === false) {
        return res.status(403).json({ message: "This account is deactivated" });
      }

      if (role === "organizer" && user.organizerApprovalStatus === "pending") {
        return res.status(403).json({ message: "Your organizer account is awaiting approval" });
      }

      if (role === "organizer" && user.organizerApprovalStatus === "rejected") {
        return res.status(403).json({ message: "Your organizer application was not approved" });
      }

      const token = jwt.sign(
        {
          id: user._id,
          role,
          organizerType: user.organizerType,
          organizationName: user.organizationName,
        },
        process.env.JWT_SECRET,
        { expiresIn: "1d" }
      );

      return res.json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role,
          organizerType: user.organizerType,
          organizationName: user.organizationName,
        },
      });
    }

    const user = userByIdentifier || await User.findOne({ email: normalizedIdentifier });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "This account is deactivated" });
    }

    if (user.role === "organizer" && user.organizerApprovalStatus === "pending") {
      return res.status(403).json({ message: "Your organizer account is awaiting approval" });
    }

    if (user.role === "organizer" && user.organizerApprovalStatus === "rejected") {
      return res.status(403).json({ message: "Your organizer application was not approved" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        organizerType: user.organizerType,
        organizationName: user.organizationName,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organizerType: user.organizerType,
        organizationName: user.organizationName,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error",
    });
  }
};

const getUsers = async (req, res) => {
  try {
    let users;
    if (req.user.role === "organizer") {
      const events = await Event.find({ organizer: req.user.id }).select("_id");
      const bookings = await Booking.find({ event: { $in: events.map((event) => event._id) } }).select("user");
      const relatedUserIds = [...new Set(bookings.map((booking) => String(booking.user)))];
      users = await User.find({ _id: { $in: relatedUserIds }, role: "user" }).select("-password");
    } else {
      users = await User.find().select("-password");
    }

    res.status(200).json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch users",
    });
  }
};

const getUserNotifications = async (req, res) => {
  try {
    const audience = req.user.role === "organizer" ? "organizers" : "users";
    const filter = {
      $or: [
        { audience: { $in: ["all", audience] }, recipient: { $exists: false } },
        { recipient: req.user.id },
      ],
    };
    if (req.user.role === "organizer") {
      const organizer = await User.findById(req.user.id).select("organizerSettings").lean();
      const settings = organizer?.organizerSettings || {};
      if (settings.notificationsEnabled === false) return res.json([]);
      const excludedTypes = [];
      if (settings.bookingAlerts === false) excludedTypes.push("booking");
      if (settings.eventApprovalAlerts === false) excludedTypes.push("event");
      if (excludedTypes.length) filter.type = { $nin: excludedTypes };
    }
    const notifications = await AdminNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: "Failed to load notifications" });
  }
};

const getAdminUsers = async (req, res) => {
  try {
    const filter = { role: "user" };
    if (req.query.search) {
      const search = String(req.query.search).trim();
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    const [users, bookingCounts] = await Promise.all([
      User.find(filter).select("-password").sort({ createdAt: -1 }).lean(),
      Booking.aggregate([
        { $group: { _id: "$user", total: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map(bookingCounts.map((entry) => [String(entry._id), entry.total]));
    res.json(users.map((user) => ({ ...user, bookingCount: counts.get(String(user._id)) || 0 })));
  } catch (error) {
    console.error("Failed to fetch admin users:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

const getAdminUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password").lean();
    if (!user || user.role !== "user") return res.status(404).json({ message: "User not found" });
    const [bookings, events] = await Promise.all([
      Booking.find({ user: user._id }).sort({ createdAt: -1 }).limit(25).populate("event", "name date type").lean(),
      Event.find({ organizer: user._id }).select("name date status").lean(),
    ]);
    res.json({ ...user, bookings, events });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to load user details" });
  }
};

const getUserBookingHistory = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("role");
    if (!user || user.role !== "user") return res.status(404).json({ message: "User not found" });
    const bookings = await Booking.find({ user: user._id })
      .sort({ createdAt: -1 })
      .populate("event", "name date type venue")
      .lean();
    res.json(bookings);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to load booking history" });
  }
};

const updateAdminUser = async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body.name === "string") updates.name = req.body.name.trim();
    if (typeof req.body.email === "string") updates.email = req.body.email.trim().toLowerCase();
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: "user" },
      updates,
      { new: true, runValidators: true }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    await logActivity({ actor: req.user.id, actorName: "Admin", action: "user.updated", description: `Updated account details for ${user.name}`, subjectType: "user", subjectId: user._id });
    res.json(user);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : error.name === "ValidationError" || error.name === "CastError" ? 400 : 500)
      .json({ message: error.code === 11000 ? "Email is already in use" : error.message || "Failed to update user" });
  }
};

const setAdminUserStatus = async (req, res) => {
  try {
    if (typeof req.body.isActive !== "boolean") return res.status(400).json({ message: "isActive must be a boolean" });
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: "user" },
      { isActive: req.body.isActive },
      { new: true }
    ).select("name email role isActive");
    if (!user) return res.status(404).json({ message: "User not found" });
    await logActivity({ actor: req.user.id, actorName: "Admin", action: req.body.isActive ? "user.activated" : "user.deactivated", description: `${req.body.isActive ? "Activated" : "Deactivated"} ${user.name}`, subjectType: "user", subjectId: user._id });
    res.json(user);
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to update user status" });
  }
};

const deleteAdminUser = async (req, res) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: "user" });
    if (!user) return res.status(404).json({ message: "User not found" });
    const bookingCount = await Booking.countDocuments({ user: user._id });
    if (bookingCount) return res.status(409).json({ message: "This user has booking history. Deactivate the account to preserve records." });
    await user.deleteOne();
    await logActivity({ actor: req.user.id, actorName: "Admin", action: "user.deleted", description: `Deleted user account ${user.name}`, subjectType: "user", subjectId: user._id });
    res.json({ message: "User deleted" });
  } catch (error) {
    res.status(error.name === "CastError" ? 400 : 500).json({ message: "Failed to delete user" });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getUsers,
  getUserNotifications,
  getAdminUsers,
  getAdminUserDetails,
  getUserBookingHistory,
  updateAdminUser,
  setAdminUserStatus,
  deleteAdminUser,
};