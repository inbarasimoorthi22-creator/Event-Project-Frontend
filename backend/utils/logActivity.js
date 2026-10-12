const ActivityLog = require("../models/ActivityLog");

const logActivity = async ({ actor, actorName, action, description, subjectType, subjectId }) => {
  try {
    await ActivityLog.create({
      actor,
      actorName: actorName || "System",
      action,
      description,
      subjectType,
      subjectId,
    });
  } catch (error) {
    console.error("Failed to write activity log:", error.message);
  }
};

module.exports = logActivity;