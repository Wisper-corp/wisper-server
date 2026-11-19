/**
 * Intelligent text summarization without external AI APIs.
 * 
 * Uses natural language processing techniques to create meaningful summaries:
 * - Sentence extraction and importance scoring
 * - Keyword identification
 * - Smart truncation at sentence boundaries
 * - Removal of filler words and redundancy
 * 
 * Requirements:
 * - Maximum 80 characters
 * - Preserves original meaning and key details
 * - Clear, professional, and grammatically correct
 * - If original is 80 characters or less, return it unchanged
 */

// Common filler words to remove when condensing
const FILLER_WORDS = new Set([
  'actually', 'basically', 'really', 'very', 'quite', 'just', 'even',
  'perhaps', 'maybe', 'probably', 'definitely', 'certainly', 'absolutely',
  'literally', 'honestly', 'truly', 'seriously', 'simply', 'merely'
]);

// Words that indicate important information
const IMPORTANT_INDICATORS = new Set([
  'expert', 'professional', 'specialist', 'experienced', 'certified',
  'custom', 'quality', 'premium', 'affordable', 'fast', 'quick',
  'design', 'develop', 'create', 'build', 'provide', 'offer',
  'service', 'help', 'assist', 'support', 'deliver', 'guaranteed'
]);

/**
 * Generates a concise summary of a service description.
 * 
 * @param caption - The original service description
 * @returns The intelligently generated summary or the original if it's short enough
 */
export function generateServiceSummary(caption: string | null): string | null {
  // No caption provided
  if (!caption) return null;

  const trimmed = caption.trim();
  
  // Caption is already short enough
  if (trimmed.length <= 80) return trimmed;

  // Try intelligent summarization
  return intelligentSummarize(trimmed, 80);
}

/**
 * Intelligently summarizes text by extracting key information.
 */
function intelligentSummarize(text: string, maxLength: number): string {
  // Split into sentences
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) {
    return smartTruncate(text, maxLength);
  }

  // Score each sentence by importance
  const scoredSentences = sentences.map(sentence => ({
    text: sentence,
    score: scoreSentence(sentence)
  }));

  // Sort by score (highest first)
  scoredSentences.sort((a, b) => b.score - a.score);

  // Try to fit the most important sentences
  let summary = '';
  for (const { text } of scoredSentences) {
    const candidate = summary ? `${summary}. ${text}` : text;
    if (candidate.length <= maxLength) {
      summary = candidate;
    } else {
      break;
    }
  }

  // If we have a good summary, return it
  if (summary && summary.length >= maxLength * 0.6) {
    return summary.length <= maxLength ? summary : smartTruncate(summary, maxLength);
  }

  // Otherwise, condense the first sentence
  const firstSentence = sentences[0];
  const condensed = condenseText(firstSentence);
  
  if (condensed.length <= maxLength) {
    return condensed;
  }

  // Last resort: smart truncation
  return smartTruncate(text, maxLength);
}

/**
 * Scores a sentence based on information density and relevance.
 */
function scoreSentence(sentence: string): number {
  const words = sentence.toLowerCase().split(/\s+/);
  let score = 0;

  // Prefer shorter, denser sentences
  score += Math.max(0, 10 - words.length);

  // Boost score for important keywords
  for (const word of words) {
    if (IMPORTANT_INDICATORS.has(word)) {
      score += 3;
    }
  }

  // Penalize for filler words
  for (const word of words) {
    if (FILLER_WORDS.has(word)) {
      score -= 1;
    }
  }

  // First sentence bonus (often contains main topic)
  return score;
}

/**
 * Condenses text by removing filler words and redundancy.
 */
function condenseText(text: string): string {
  let condensed = text;

  // Remove filler words
  const words = condensed.split(/\s+/);
  const filtered = words.filter(word => 
    !FILLER_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, ''))
  );
  condensed = filtered.join(' ');

  // Remove redundant phrases
  condensed = condensed
    .replace(/\s+(and|or)\s+more/gi, '')
    .replace(/\s+etc\.?/gi, '')
    .replace(/\s+and so on/gi, '')
    .replace(/\s*\([^)]*\)/g, '') // Remove parenthetical notes
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
    .trim();

  return condensed;
}

/**
 * Truncates text intelligently at word boundaries, avoiding mid-word cuts.
 */
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const ellipsis = '...';
  const targetLength = maxLength - ellipsis.length;

  // Try to truncate at sentence boundary
  const sentenceMatch = text.slice(0, targetLength).match(/^.*[.!?]/);
  if (sentenceMatch && sentenceMatch[0].length >= targetLength * 0.5) {
    return sentenceMatch[0];
  }

  // Try to truncate at word boundary
  const truncated = text.slice(0, targetLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > targetLength * 0.7) {
    return truncated.slice(0, lastSpace) + ellipsis;
  }

  // Try to truncate at comma or other punctuation
  const lastPunct = Math.max(
    truncated.lastIndexOf(','),
    truncated.lastIndexOf(';'),
    truncated.lastIndexOf(':')
  );

  if (lastPunct > targetLength * 0.7) {
    return truncated.slice(0, lastPunct) + ellipsis;
  }

  // Last resort: truncate at last space found
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + ellipsis;
  }

  return truncated + ellipsis;
}

/**
 * Batch generates summaries for multiple posts.
 * Useful for backfilling existing posts.
 * 
 * @param posts - Array of posts with captions
 * @returns Array of summaries in the same order
 */
export function batchGenerateSummaries(
  posts: Array<{ id: string; caption: string | null }>
): Array<{ id: string; aiSummary: string | null }> {
  return posts.map(post => ({
    id: post.id,
    aiSummary: generateServiceSummary(post.caption)
  }));
}
