const AdminNotification = require("../models/AdminNotification");
const PlatformSettings = require("../models/PlatformSettings");

const createNotification = async (notification) => {
  try {
    const settings = await PlatformSettings.findOne({ key: "platform" }).select("notificationsEnabled").lean();
    if (settings?.notificationsEnabled === false) return null;
    return await AdminNotification.create(notification);
  } catch (error) {
    console.error("Failed to create notification:", error.message);
    return null;
  }
};

module.exports = createNotification;