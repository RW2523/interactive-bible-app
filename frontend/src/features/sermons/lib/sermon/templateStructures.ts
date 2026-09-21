import type { TemplateType } from '../../types'

// Each sermon format has its OWN outline — the named sections (and the
// subtopics within them) the content should be organized into. When the user
// picks a format, the raw content is re-mapped into THIS structure so the
// format actually restructures the message (not just restyles it) and nothing
// from the source is dropped.

export interface TemplateSection {
  name: string
  subtopics: string[]
}

export interface TemplateStructure {
  label: string
  summary: string
  /** The ordered content sections that become the sermon's main points. */
  sections: TemplateSection[]
}

export const TEMPLATE_STRUCTURES: Record<TemplateType, TemplateStructure> = {
  message: {
    label: 'Sunday Message',
    summary: 'A classic expository message with a hook, three developed points, and a call to action.',
    sections: [
      { name: 'Opening Hook', subtopics: ['Engaging story, question, or image', 'Why this matters today'] },
      { name: 'Scripture in Context', subtopics: ['Read the passage', 'Historical / literary setting', 'The big idea'] },
      { name: 'Point One', subtopics: ['Truth from the text', 'Illustration', 'Application'] },
      { name: 'Point Two', subtopics: ['Truth from the text', 'Illustration', 'Application'] },
      { name: 'Point Three', subtopics: ['Truth from the text', 'Illustration', 'Application'] },
      { name: 'Call to Action', subtopics: ['What to do this week', 'A memorable closing line'] },
    ],
  },
  prayer: {
    label: 'Prayer Focus',
    summary: 'A guided prayer message moving through adoration, confession, thanksgiving, and supplication.',
    sections: [
      { name: 'Invocation', subtopics: ['Inviting God’s presence', 'Grounding scripture'] },
      { name: 'Adoration & Praise', subtopics: ['Who God is', 'Attributes worth praising'] },
      { name: 'Confession', subtopics: ['Honest repentance', 'Receiving grace'] },
      { name: 'Thanksgiving', subtopics: ['Gratitude for specific gifts'] },
      { name: 'Supplication', subtopics: ['Personal', 'Family', 'Church', 'Nation & world'] },
      { name: 'Benediction', subtopics: ['Sending blessing', 'Closing scripture'] },
    ],
  },
  story: {
    label: 'Story-Driven',
    summary: 'A narrative sermon built around a biblical character or scene, weaving ancient and modern.',
    sections: [
      { name: 'Opening Scene', subtopics: ['Set the scene vividly', 'Emotional entry point'] },
      { name: 'The Character', subtopics: ['Who they are', 'Their struggle or longing'] },
      { name: 'Rising Action', subtopics: ['The turning tension', 'The encounter with God'] },
      { name: 'The Climax', subtopics: ['The decisive moment', 'What changes'] },
      { name: 'Resolution', subtopics: ['How it ends', 'The parallel to our lives'] },
      { name: 'Spiritual Takeaway', subtopics: ['The one truth to carry home'] },
    ],
  },
  devotional: {
    label: 'Devotional',
    summary: 'A short, intimate daily reflection on a single verse with one application and a prayer.',
    sections: [
      { name: 'The Verse', subtopics: ['A focal passage'] },
      { name: 'Reflection', subtopics: ['What it means', 'Why it matters to the heart'] },
      { name: 'Application', subtopics: ['One concrete step or question'] },
      { name: 'Prayer', subtopics: ['A short guided prayer'] },
    ],
  },
  teaching: {
    label: 'Bible Teaching',
    summary: 'An in-depth expository study with context, verse-by-verse exposition, and discussion.',
    sections: [
      { name: 'Learning Objectives', subtopics: ['What the listener will understand'] },
      { name: 'Historical & Cultural Context', subtopics: ['Author, audience, setting'] },
      { name: 'Verse-by-Verse Exposition', subtopics: ['Walk the passage', 'Key phrases explained'] },
      { name: 'Word Studies', subtopics: ['Greek / Hebrew insight', 'Original meaning'] },
      { name: 'Cross-References', subtopics: ['Where Scripture interprets Scripture'] },
      { name: 'Application', subtopics: ['Living the text'] },
      { name: 'Discussion Questions', subtopics: ['For reflection or small groups'] },
    ],
  },
  testimony: {
    label: 'Testimony',
    summary: 'A personal-witness arc: the before, the turning point, the after, anchored in scripture.',
    sections: [
      { name: 'Before — The Struggle', subtopics: ['Life before the change', 'The need or pain'] },
      { name: 'The Turning Point', subtopics: ['How God intervened', 'The decisive encounter'] },
      { name: 'After — The Transformation', subtopics: ['What changed', 'The new reality'] },
      { name: 'Scripture Backing', subtopics: ['Verses that frame the story'] },
      { name: 'Invitation', subtopics: ['Encouraging others to trust God'] },
    ],
  },
  youth: {
    label: 'Youth Message',
    summary: 'A high-energy, relatable message with punchy points and a real-world challenge.',
    sections: [
      { name: 'High-Energy Opener', subtopics: ['Culturally relevant hook', 'A relatable question'] },
      { name: 'Big Idea', subtopics: ['One clear truth in plain language'] },
      { name: 'Real-Life Points', subtopics: ['2–3 short, punchy points', 'Modern illustrations'] },
      { name: 'The Challenge', subtopics: ['A dare for the week'] },
      { name: 'Closing', subtopics: ['An inspiring, action-oriented send-off'] },
    ],
  },
  small_group: {
    label: 'Small Group Guide',
    summary: 'A facilitator-ready discussion guide with an icebreaker, study, questions, and prayer.',
    sections: [
      { name: 'Icebreaker', subtopics: ['An opening question to warm up'] },
      { name: 'Read the Passage', subtopics: ['The text to study together'] },
      { name: 'Teaching Context', subtopics: ['Brief background for the leader'] },
      { name: 'Discussion Questions', subtopics: ['Observation', 'Interpretation', 'Application'] },
      { name: 'Application Challenge', subtopics: ['A practical step or homework'] },
      { name: 'Prayer Focus', subtopics: ['Group prayer points'] },
    ],
  },
  storytelling: {
    label: 'Storytelling',
    summary: 'A cinematic, spoken-aloud narrative with sensory language and a returning motif.',
    sections: [
      { name: 'The Hook', subtopics: ['A gripping first 90 seconds'] },
      { name: 'Interwoven Narrative', subtopics: ['Biblical and modern stories in parallel'] },
      { name: 'Sensory Build', subtopics: ['Vivid, descriptive imagery'] },
      { name: 'The Turn', subtopics: ['Setup, conflict, climax'] },
      { name: 'Resolution & Motif', subtopics: ['Return to the opening image', 'The lasting truth'] },
    ],
  },
  custom: {
    label: 'Custom Polish',
    summary: 'Keep the sermon’s own structure; strengthen clarity, transitions, and scripture.',
    sections: [
      { name: 'Introduction', subtopics: ['Sharpen the opening'] },
      { name: 'Main Points', subtopics: ['Preserve and strengthen the existing points'] },
      { name: 'Application', subtopics: ['Make it concrete'] },
      { name: 'Conclusion', subtopics: ['A strong close'] },
    ],
  },
}

/** A compact, prompt-ready outline string for the chosen format. */
export function structureOutline(t: TemplateType): string {
  const s = TEMPLATE_STRUCTURES[t] ?? TEMPLATE_STRUCTURES.custom
  return s.sections
    .map((sec, i) => `${i + 1}. ${sec.name} — ${sec.subtopics.join('; ')}`)
    .join('\n')
}
