const mongoose = require("mongoose");

const connectDB = async () => {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/event_management";

    try {
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
        });
        console.log("MongoDB Connected");
        return true;
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
        console.warn("Express server is starting without MongoDB. Configure a valid MONGO_URI or start MongoDB to enable database features.");
        return false;
    }
};

module.exports = connectDB;