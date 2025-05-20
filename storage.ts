import { users, reports, type User, type InsertUser, type Report, type InsertReport } from "@shared/schema";

// Storage interface with CRUD methods
export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createReport(report: InsertReport): Promise<Report>;
  getReports(): Promise<Report[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private reports: Map<number, Report>;
  private userIdCounter: number;
  private reportIdCounter: number;

  constructor() {
    this.users = new Map();
    this.reports = new Map();
    this.userIdCounter = 1;
    this.reportIdCounter = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  
  async createReport(insertReport: InsertReport): Promise<Report> {
    const id = this.reportIdCounter++;
    const report: Report = { ...insertReport, id };
    this.reports.set(id, report);
    return report;
  }
  
  async getReports(): Promise<Report[]> {
    return Array.from(this.reports.values());
  }
}

export const storage = new MemStorage();
