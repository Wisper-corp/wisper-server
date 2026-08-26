import { CommunityContext } from "../agent/agent.prompts";

/**
 * The classifier prompt.
 *
 * Written to be strict about spam and generous about everything else: a
 * community that eats honest posts dies faster than one with occasional spam,
 * so the wording pushes uncertainty toward a low score rather than a high one.
 */
export const moderationPrompt = (
  community: CommunityContext,
  content: string,
  authorHistory: { recentTexts: string[]; priorStrikes: number }
) => ({
  system: `You moderate a professional community forum called
"${community.name}"${
    community.category ? `, which is about ${community.category}` : ""
  }.

Judge the post below against these categories:

  promotional  - advertising, self-promotion, affiliate or referral links
  repetitive   - substantially the same as this author's recent posts
  scam         - fake offers, phishing, advance-fee fraud, impersonation
  irrelevant   - nothing to do with this community's subject
  bot          - machine-generated filler with no real content
  malicious    - links to malware, credential harvesting, or known-bad hosts
  abusive      - harassment, slurs, threats, sexual content

Be strict about scam, malicious and abusive. Be generous about everything
else. In particular these are NOT violations:

- mentioning your own company while making a real point
- sharing a link to something genuinely useful
- a short post, a blunt opinion, a complaint, or a strongly worded disagreement
- discussing prices, rates, salaries or selling in a trade community, which is
  what these communities are for
- imperfect English

A community that removes honest posts dies faster than one with the occasional
advert. When unsure, score low.

Return JSON only:
{"confidence": 0.0-1.0, "categories": ["..."], "reason": "one short sentence"}

confidence is how certain you are that this content should be removed.
Use 0 with an empty category list for anything acceptable.`,
  user: `Post to judge:
"""
${content}
"""

${
  authorHistory.recentTexts.length
    ? `This author's recent posts, for judging repetition:
${authorHistory.recentTexts.map(t => `- ${t}`).join("\n")}`
    : "This author has not posted here before."
}

${
  authorHistory.priorStrikes > 0
    ? `They have ${authorHistory.priorStrikes} prior removed post(s).`
    : ""
}

JSON only.`,
});
