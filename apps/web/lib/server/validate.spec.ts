import { describe, expect, it } from "vitest";
import { isEmail, isHeaderSafe, passwordProblem, str } from "./validate";

describe("isEmail", () => {
  it("accepts the shapes an MTA would", () => {
    for (const address of [
      "ada@example.com",
      "ada.lovelace@sub.example.co.uk",
      "ada+mailserver@example.com",
      "a@b.co",
      "user_name-1@example-host.org",
    ]) {
      expect(isEmail(address), address).toBe(true);
    }
  });

  it("rejects the shapes it would not", () => {
    for (const address of [
      "", "ada", "ada@", "@example.com", "ada@@example.com", "ada@example",
      "ada..lovelace@example.com", ".ada@example.com", "ada.@example.com",
      "ada@-example.com", "ada@example-.com", "ada lovelace@example.com",
    ]) {
      expect(isEmail(address), address).toBe(false);
    }
  });

  it("enforces the RFC length limits", () => {
    expect(isEmail(`${"a".repeat(65)}@example.com`)).toBe(false);
    expect(isEmail(`${"a".repeat(64)}@example.com`)).toBe(true);
    expect(isEmail(`a@${"b".repeat(250)}.com`)).toBe(false);
  });

  it("rejects non-strings rather than coercing", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(isEmail(value)).toBe(false);
    }
  });

  it("returns quickly on a long adversarial input", () => {
    // Guards against catastrophic backtracking: the classic email regex hangs
    // on inputs like this, and a hanging validator is a denial of service.
    const hostile = `${"a".repeat(60)}@${"a.".repeat(40)}`;
    const started = Date.now();
    isEmail(hostile);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("isHeaderSafe", () => {
  it("rejects anything carrying CR or LF", () => {
    // This is the SMTP header-injection guard. A subject containing a newline
    // followed by "Bcc:" turns one message into a relay.
    expect(isHeaderSafe("Quarterly report")).toBe(true);
    expect(isHeaderSafe("Subject\r\nBcc: victim@example.com")).toBe(false);
    expect(isHeaderSafe("Subject\nBcc: victim@example.com")).toBe(false);
    expect(isHeaderSafe("Subject\rmore")).toBe(false);
  });

  it("rejects the Unicode line separators too", () => {
    // U+2028/U+2029 are line breaks that some parsers honour.
    expect(isHeaderSafe("a b")).toBe(false);
    expect(isHeaderSafe("a b")).toBe(false);
  });
});

describe("str", () => {
  it("trims and enforces bounds", () => {
    expect(str("  hello  ", 10)).toBe("hello");
    expect(str("", 10)).toBeNull();
    expect(str("   ", 10)).toBeNull();
    expect(str("toolong", 3)).toBeNull();
    expect(str(42, 10)).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("requires a real length rather than character classes", () => {
    // Length beats composition rules: "correct horse battery staple" is
    // stronger than "P@ss1!" and a class rule would reject it.
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(passwordProblem("short")).toBe("Use at least 12 characters.");
    expect(passwordProblem("elevenchar")).toBe("Use at least 12 characters.");
  });

  it("rejects a non-string and an absurd length", () => {
    expect(passwordProblem(undefined)).toBe("Password is required.");
    expect(passwordProblem("a".repeat(2000))).toBe("That password is too long.");
  });
});
