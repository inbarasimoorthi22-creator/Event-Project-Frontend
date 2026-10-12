const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["user", "organizer", "admin"],
      default: "user",
    },

    fixedAccountKey: {
      type: String,
      enum: ["admin", "organizer", "privateOrganizer"],
    },

    organizerType: {
      type: String,
      enum: ["college", "school", "corporate", "private"],
    },

    organizerApprovalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    profileImage: {
      type: String,
      default: "",
    },

    phoneNumber: {
      type: String,
      trim: true,
      default: "",
    },

    organizerSettings: {
      notificationsEnabled: { type: Boolean, default: true },
      bookingAlerts: { type: Boolean, default: true },
      eventApprovalAlerts: { type: Boolean, default: true },
    },

    organizationName: {
      type: String,
      trim: true,
    },

    organizerId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    organizerPassword: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);