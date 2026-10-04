const mockValues = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockValues.delete(key); }),
}));

import { session } from "./session";

const user = (id: string) => ({ id, uid: id, email: `${id}@example.test`, role: "finance-desk" });

describe("Finance Desk secure session cursor", () => {
  beforeEach(() => mockValues.clear());

  it("persists the processed event cursor across session rehydration", async () => {
    await session.set("token-a", user("user-a"));
    await session.setLastEventId("42");

    expect(await session.getLastEventId()).toBe("42");
  });

  it("clears the old user's cursor when the authenticated account changes", async () => {
    await session.set("token-a", user("user-a"));
    await session.setLastEventId("42");

    await session.set("token-b", user("user-b"));

    expect(await session.getLastEventId()).toBe("");
  });

  it("clears the cursor on logout", async () => {
    await session.set("token-a", user("user-a"));
    await session.setLastEventId("42");

    await session.clear();

    expect(await session.getLastEventId()).toBe("");
    expect(await session.getToken()).toBeNull();
  });
});
