import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import WebSocket from "ws";

export async function registerRoutes(app: Express): Promise<Server> {
  // Create HTTP server
  const httpServer = createServer(app);
  
  // Create Socket.IO server
  const io = new SocketIOServer(httpServer, {
    path: "/ws/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });
  
  // Connection pool for active users
  const activeUsers = new Map();
  
  // Queue of users waiting to be matched
  const waitingUsers = {
    male: new Set(),
    female: new Set(),
    both: new Set()
  };
  
  // Match users based on preferences
  function findMatch(socket) {
    const user = activeUsers.get(socket.id);
    if (!user) return null;
    
    // Determine which waiting pool to look in based on gender preference
    let potentialMatches;
    if (user.preferences.gender === "male") {
      potentialMatches = Array.from(waitingUsers.male);
    } else if (user.preferences.gender === "female") {
      potentialMatches = Array.from(waitingUsers.female);
    } else {
      // Both genders - combine the pools
      potentialMatches = [
        ...Array.from(waitingUsers.male),
        ...Array.from(waitingUsers.female),
        ...Array.from(waitingUsers.both)
      ];
    }
    
    // Filter by country if specified
    if (user.preferences.country !== "any") {
      potentialMatches = potentialMatches.filter(id => {
        const match = activeUsers.get(id);
        return match && (match.preferences.country === user.preferences.country || match.preferences.country === "any");
      });
    }
    
    // Return first valid match
    for (const matchId of potentialMatches) {
      if (matchId !== socket.id) {
        return matchId;
      }
    }
    
    return null;
  }
  
  // Add user to waiting pool
  function addToWaitingPool(socket) {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    // Remove from all waiting pools first (in case preferences changed)
    waitingUsers.male.delete(socket.id);
    waitingUsers.female.delete(socket.id);
    waitingUsers.both.delete(socket.id);
    
    // Add to appropriate waiting pool
    if (user.gender === "male") {
      waitingUsers.male.add(socket.id);
    } else if (user.gender === "female") {
      waitingUsers.female.add(socket.id);
    } else {
      waitingUsers.both.add(socket.id);
    }
  }
  
  // Remove user from waiting pools
  function removeFromWaitingPools(socketId) {
    waitingUsers.male.delete(socketId);
    waitingUsers.female.delete(socketId);
    waitingUsers.both.delete(socketId);
  }
  
  // Socket.IO connection handling
  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Initialize user
    activeUsers.set(socket.id, {
      id: socket.id,
      gender: "both", // Default gender
      preferences: {
        gender: "both",
        country: "any"
      },
      currentPeer: null
    });
    
    // Update user preferences
    socket.on("update-preferences", (preferences) => {
      const user = activeUsers.get(socket.id);
      if (user) {
        user.preferences = preferences;
        activeUsers.set(socket.id, user);
      }
    });
    
    // Find a peer to chat with
    socket.on("find-peer", () => {
      const user = activeUsers.get(socket.id);
      if (!user) return;
      
      // If already connected to a peer, disconnect first
      if (user.currentPeer) {
        const peer = activeUsers.get(user.currentPeer);
        if (peer) {
          peer.currentPeer = null;
          activeUsers.set(user.currentPeer, peer);
          
          // Notify peer of disconnection
          io.to(user.currentPeer).emit("peer-disconnected");
        }
        
        user.currentPeer = null;
      }
      
      // Try to find a match
      const matchId = findMatch(socket);
      
      if (matchId) {
        // Found a match
        const match = activeUsers.get(matchId);
        
        // Update both users
        user.currentPeer = matchId;
        match.currentPeer = socket.id;
        
        activeUsers.set(socket.id, user);
        activeUsers.set(matchId, match);
        
        // Remove both from waiting pools
        removeFromWaitingPools(socket.id);
        removeFromWaitingPools(matchId);
        
        // Notify both users
        socket.emit("ready");
        io.to(matchId).emit("ready");
      } else {
        // No match found, add to waiting pool
        addToWaitingPool(socket);
      }
    });
    
    // WebRTC signaling
    socket.on("offer", (offer) => {
      const user = activeUsers.get(socket.id);
      if (user && user.currentPeer) {
        io.to(user.currentPeer).emit("offer", offer);
      }
    });
    
    socket.on("answer", (answer) => {
      const user = activeUsers.get(socket.id);
      if (user && user.currentPeer) {
        io.to(user.currentPeer).emit("answer", answer);
      }
    });
    
    socket.on("ice-candidate", (candidate) => {
      const user = activeUsers.get(socket.id);
      if (user && user.currentPeer) {
        io.to(user.currentPeer).emit("ice-candidate", candidate);
      }
    });
    
    // Chat messages
    socket.on("chat-message", (message) => {
      const user = activeUsers.get(socket.id);
      if (user && user.currentPeer) {
        io.to(user.currentPeer).emit("chat-message", message);
      }
    });
    
    // Report user
    socket.on("report-user", ({ reason, details }) => {
      const user = activeUsers.get(socket.id);
      if (user && user.currentPeer) {
        // Store report in database
        storage.createReport({
          reporterId: socket.id,
          reportedId: user.currentPeer,
          reason,
          details,
          timestamp: new Date()
        });
        
        // Disconnect users
        const peer = activeUsers.get(user.currentPeer);
        if (peer) {
          peer.currentPeer = null;
          activeUsers.set(user.currentPeer, peer);
          io.to(user.currentPeer).emit("peer-disconnected");
        }
        
        user.currentPeer = null;
        activeUsers.set(socket.id, user);
      }
    });
    
    // Disconnect handling
    socket.on("disconnect", () => {
      const user = activeUsers.get(socket.id);
      
      if (user && user.currentPeer) {
        // Notify peer of disconnection
        io.to(user.currentPeer).emit("peer-disconnected");
        
        // Update peer
        const peer = activeUsers.get(user.currentPeer);
        if (peer) {
          peer.currentPeer = null;
          activeUsers.set(user.currentPeer, peer);
        }
      }
      
      // Remove from waiting pools and active users
      removeFromWaitingPools(socket.id);
      activeUsers.delete(socket.id);
      
      console.log(`User disconnected: ${socket.id}`);
    });
  });
  
  return httpServer;
}
