const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    organizer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    legacyId: {
      type: Number,
      index: true,
    },

    organizationName: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "completed"],
      default: "pending",
    },

    name: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      required: true,
      enum: ["college", "school", "corporate", "private"],
    },

    category: {
      type: String,
      required: function () { return this.status !== "draft"; },
    },

    date: {
      type: String,
      required: function () { return this.status !== "draft"; },
    },

    time: {
      type: String,
      required: function () { return this.status !== "draft"; },
    },

    venue: {
      type: String,
      required: function () { return this.status !== "draft"; },
    },

    price: {
      type: Number,
      default: 0,
    },

    image: {
      type: String,
      default: "",
    },

    description: {
      type: String,
      default: "",
    },

    availableTickets: {
      type: Number,
      default: 100,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Event", eventSchema);