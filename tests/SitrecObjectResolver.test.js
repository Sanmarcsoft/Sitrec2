import {
    extractSitrecObjectKey,
    resolveSitrecReference,
    toCanonicalSitrecRef,
} from "../src/SitrecObjectResolver";

describe("SitrecObjectResolver", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test("normalizes canonical refs with encoded segments to decoded canonical form", () => {
        const value = "sitrec://99999999/MW%20Seeds%20480p-790686eede4f.mp4";
        expect(extractSitrecObjectKey(value)).toBe("99999999/MW Seeds 480p-790686eede4f.mp4");
        expect(toCanonicalSitrecRef(value)).toBe("sitrec://99999999/MW Seeds 480p-790686eede4f.mp4");
    });

    test("normalizes raw encoded keys to decoded canonical refs", () => {
        const value = "99999999/MW%20Seeds%20480p-790686eede4f.mp4";
        expect(extractSitrecObjectKey(value)).toBe("99999999/MW Seeds 480p-790686eede4f.mp4");
        expect(toCanonicalSitrecRef(value)).toBe("sitrec://99999999/MW Seeds 480p-790686eede4f.mp4");
    });

    test("resolveSitrecReference queries object.php with canonical decoded ref (no double encoding)", async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            json: async () => ({
                ref: "sitrec://99999999/MW Seeds 480p-790686eede4f.mp4",
                key: "99999999/MW Seeds 480p-790686eede4f.mp4",
                url: "https://example.com/video.mp4",
                expiresAt: null,
            }),
        }));
        global.fetch = fetchMock;

        await resolveSitrecReference("sitrec://99999999/MW%20Seeds%20480p-790686eede4f.mp4", {force: true});

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledUrl = fetchMock.mock.calls[0][0];
        expect(calledUrl).toContain("object.php?ref=sitrec%3A%2F%2F99999999%2FMW%20Seeds%20480p-790686eede4f.mp4");
        expect(calledUrl).not.toContain("%2520");
    });
});

