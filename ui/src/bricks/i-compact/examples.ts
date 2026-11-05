import type { ReadingTopic } from "./model";

export function exampleTopics(changed: boolean): ReadingTopic[] {
  return [
    { id: "example-pilot", title: "Start small. Learn before expanding.", parent: null, sources: [
      { id: "example-scope", speaker: "Coordinator", ai: false,
        concise: changed ? "Try one neighbourhood for four weeks, if permission comes through." : "Try one neighbourhood for two weeks, if permission comes through.",
        original: `I think we should try just one neighbourhood for ${changed ? "four" : "two"} weeks first. But only if permission comes through. If it does not, we should wait rather than send invitations anyway.`,
        uncertainty: "Proposal · permission unconfirmed", reason: "" },
      { id: "example-measure", speaker: "Contributor", ai: false,
        concise: "Measure repeat borrowing; sign-ups alone do not show usefulness.",
        original: "Can we measure whether people borrow a second time? Sign-ups are easy to count, but they do not tell us whether the library was useful after that first visit.",
        uncertainty: "Suggested measure · not an agreed decision", reason: "" },
    ] },
    { id: "example-permission", title: "Permission comes before invitations", parent: "example-pilot", sources: [
      { id: "example-room", speaker: "Coordinator", ai: false,
        concise: "The room is available. The permit is still pending.", // names-ok: physical venue, not a Shared map
        original: "The room is available on Saturday. We still do not have the permit, so please do not treat the room booking as permission to launch.", // names-ok: physical venue, not a Shared map; preserve the example's original wording
        uncertainty: "Permit pending", reason: "" },
    ] },
  ];
}
