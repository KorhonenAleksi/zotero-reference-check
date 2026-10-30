import { describe, expect, it } from "vitest";
import { classifyLink, displayLink } from "../../src/core/links";

describe("classifyLink", () => {
  it("recognises research databases", () => {
    expect(
      classifyLink(
        "https://search.ebscohost.com/login.aspx?direct=true&db=bth&AN=9509210295&site=ehost-live&authtype=sso&custid=ns000000",
      ),
    ).toMatchObject({ kind: "database", source: "EBSCO" });
    expect(
      classifyLink("https://research.ebsco.com/c/abc/details/xyz"),
    ).toMatchObject({ source: "EBSCO" });
    expect(
      classifyLink("https://www.proquest.com/docview/1234567"),
    ).toMatchObject({ source: "ProQuest" });
    expect(
      classifyLink("https://search.proquest.com/openview/abc"),
    ).toMatchObject({ source: "ProQuest" });
    expect(classifyLink("https://www.jstor.org/stable/2393553")).toMatchObject({
      source: "JSTOR",
    });
  });

  it("recognises library proxies before the database behind them", () => {
    expect(
      classifyLink("https://www.jstor.org.libproxy.example.edu/stable/2393553"),
    ).toMatchObject({
      kind: "proxy",
      host: "www.jstor.org.libproxy.example.edu",
    });
    expect(
      classifyLink("https://login.example.edu/login?url=https://example.org"),
    ).toMatchObject({ kind: "proxy" });
    expect(
      classifyLink("https://www-sciencedirect-com.ezproxy.example.edu/x"),
    ).toMatchObject({ kind: "proxy" });
    expect(
      classifyLink("https://onlinelibrary-wiley-com.ezp.lib.example.ac.uk/x"),
    ).toMatchObject({ kind: "proxy" });
    expect(
      classifyLink("https://www-jstor-org.example.idm.oclc.org/stable/1"),
    ).toMatchObject({ kind: "proxy" });
  });

  it("recognises academic social networks", () => {
    expect(
      classifyLink("https://www.researchgate.net/publication/123_Title"),
    ).toMatchObject({ kind: "network", source: "ResearchGate" });
    expect(classifyLink("https://scholar.google.fi/scholar?q=x")).toMatchObject(
      { source: "Google Scholar" },
    );
  });

  it("keeps publisher, repository and other links", () => {
    for (const url of [
      "https://onlinelibrary.wiley.com/doi/10.1002/smj.4250050207",
      "https://journals.sagepub.com/doi/10.1177/0170840610397486",
      "https://www.sciencedirect.com/science/article/pii/S0024630114000",
      "https://www.tandfonline.com/doi/full/10.1080/00076791.2020.1",
      "https://deepblue.lib.umich.edu/handle/2027.42/1",
      "https://opus.lib.uts.edu.au/handle/10453/1",
      "https://journal.fi/ht/article/view/1",
      "https://doi.org/10.1002/smj.70136",
      "https://www.ebsco-not.example.com/x",
    ]) {
      expect(classifyLink(url), url).toBeNull();
    }
  });

  it("handles links stored without a scheme", () => {
    expect(classifyLink("www.jstor.org/stable/2486455")).toMatchObject({
      source: "JSTOR",
    });
    expect(classifyLink("onlinelibrary.wiley.com/doi/10.1/x")).toBeNull();
  });

  it("ignores empty and non-web values", () => {
    expect(classifyLink("")).toBeNull();
    expect(classifyLink(undefined)).toBeNull();
    expect(classifyLink("not a url")).toBeNull();
    expect(classifyLink("file:///Users/x/paper.pdf")).toBeNull();
  });
});

describe("displayLink", () => {
  it("drops scheme and www, and shortens", () => {
    expect(displayLink("https://www.jstor.org/stable/1704346")).toBe(
      "jstor.org/stable/1704346",
    );
    const long = displayLink(
      "https://search.ebscohost.com/login.aspx?direct=true&db=bth&AN=9509210295&site=ehost-live&authtype=sso&custid=ns000000",
    );
    expect(long).toHaveLength(70);
    expect(long.startsWith("search.ebscohost.com/login.aspx?")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
  });
});
