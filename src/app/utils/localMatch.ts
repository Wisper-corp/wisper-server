import prisma from "./prisma";

/// Matching "near me" against free text.
///
/// Neither a job nor a person carries a structured place — a job has
/// `location` ("Lagos", "Lagos, Nigeria", "Brazil", "Remote") and a person has
/// `address` ("Lagos, Nigeria"). So a match is done on the parts: split both on
/// commas and slashes, and call it local when any part of one appears in the
/// other.
///
/// "Remote" and "Worldwide" fall out of this naturally — they match nobody's
/// city or country, so they are never local without being special-cased.

/// Two characters or fewer is noise ("NG", "UK" are the arguable losses, but
/// admitting them would also admit every stray fragment).
const MIN_TOKEN = 3;

export const locationTokens = (text?: string | null): string[] => {
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[,/|·•\-–—]+/)
        .map(part => part.trim())
        .filter(part => part.length >= MIN_TOKEN)
    )
  );
};

/// Whether a place matches a person's own place, by the rule above.
export const isLocalTo = (place?: string | null, home?: string | null) => {
  const mine = locationTokens(home);
  if (!mine.length) return false;
  const theirs = locationTokens(place);
  if (!theirs.length) return false;
  return theirs.some(part => mine.includes(part));
};

/// The caller's own place, from whichever profile they have.
export const homeLocationOf = async (authId: string) => {
  const auth = await prisma.auth.findUnique({
    where: { id: authId },
    select: {
      person: { select: { address: true } },
      business: { select: { address: true } },
    },
  });
  return auth?.person?.address || auth?.business?.address || null;
};

/// True when the request asked for local results. Query params are strings, so
/// "false" must not read as truthy.
export const wantsLocal = (raw: unknown) => raw === true || raw === "true";
