const mongoose = require("mongoose");

const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "platform", unique: true },
    platformName: { type: String, default: "EventHub", trim: true },
    supportEmail: { type: String, default: "", trim: true },
    eventsRequireApproval: { type: Boolean, default: true },
    bookingsEnabled: { type: Boolean, default: true },
    notificationsEnabled: { type: Boolean, default: true },
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformSettings", platformSettingsSchema);