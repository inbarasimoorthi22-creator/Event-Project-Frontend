const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, required: true },
    action: { type: String, required: true },
    description: { type: String, required: true },
    subjectType: { type: String, default: "system" },
    subjectId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ActivityLog", activityLogSchema);