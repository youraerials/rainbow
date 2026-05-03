import { describe, it, expect } from "vitest";
import { validateSubdomain } from "../src/subdomain-manager/validation";

describe("validateSubdomain", () => {
  it("accepts valid subdomains", () => {
    expect(validateSubdomain("myserver").valid).toBe(true);
    expect(validateSubdomain("my-server").valid).toBe(true);
    expect(validateSubdomain("abc").valid).toBe(true);
    expect(validateSubdomain("a1b2c3").valid).toBe(true);
    expect(validateSubdomain("my-cool-server-2024").valid).toBe(true);
  });

  it("rejects subdomains that are too short", () => {
    const result = validateSubdomain("ab");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least 3");
  });

  it("rejects subdomains that are too long", () => {
    const result = validateSubdomain("a".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("63 characters");
  });

  it("rejects uppercase characters", () => {
    const result = validateSubdomain("MyServer");
    expect(result.valid).toBe(false);
  });

  it("rejects subdomains starting with a hyphen", () => {
    const result = validateSubdomain("-myserver");
    expect(result.valid).toBe(false);
  });

  it("rejects subdomains ending with a hyphen", () => {
    const result = validateSubdomain("myserver-");
    expect(result.valid).toBe(false);
  });

  it("rejects consecutive hyphens", () => {
    const result = validateSubdomain("my--server");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("consecutive hyphens");
  });

  it("rejects reserved names", () => {
    expect(validateSubdomain("www").valid).toBe(false);
    expect(validateSubdomain("admin").valid).toBe(false);
    expect(validateSubdomain("mail").valid).toBe(false);
    expect(validateSubdomain("rainbow").valid).toBe(false);
  });

  it("rejects blocked patterns", () => {
    expect(validateSubdomain("xxx").valid).toBe(false);
    expect(validateSubdomain("xxxx").valid).toBe(false);
    expect(validateSubdomain("test").valid).toBe(false);
    expect(validateSubdomain("test123").valid).toBe(false);
  });

  it("allows names that start with reserved prefixes", () => {
    expect(validateSubdomain("www-rocks").valid).toBe(true);
    expect(validateSubdomain("admin-panel").valid).toBe(true);
    expect(validateSubdomain("testing").valid).toBe(true);
  });
});
