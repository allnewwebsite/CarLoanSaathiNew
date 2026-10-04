import { listCases } from "./cases";
import { api } from "./client";

jest.mock("./client", () => ({
  api: {
    get: jest.fn(),
  },
}));

describe("case list query", () => {
  const mockedGet = api.get as jest.MockedFunction<typeof api.get>;

  beforeEach(() => {
    mockedGet.mockReset();
  });

  test("strips the client-side status filter while keeping search, paging, and auth scoping intact", async () => {
    mockedGet.mockResolvedValue({
      data: {
        data: [{ id: "CLS-0001", caseId: "CLS-0001" }],
        nextCursor: "next-page",
        hasMore: true,
      },
    });

    const result = await listCases({
      search: "CLS-0001",
      status: "Pending Documents",
      cursor: "abc",
      limit: 10,
    });

    expect(mockedGet).toHaveBeenCalledWith("/dealer/leads", {
      params: {
        limit: 10,
        search: "CLS-0001",
        cursor: "abc",
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("next-page");
    expect(result.hasMore).toBe(true);
  });
});
