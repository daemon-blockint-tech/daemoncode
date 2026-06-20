/**
 * Five-layer Crystalline cognitive memory with semiotic links.
 *
 * Reuses the arc-agi-crystalline pattern: memory is stratified into five layers
 * (episodic, semantic, procedural, analogical, principle). The kernel's shield
 * predicate f_enforce is built from PRINCIPLE memories (blockedActions /
 * requiredSOP) plus SEMIOTIC LINKS that resolve synonyms and paraphrases of a
 * forbidden action back to its canonical form.
 *
 * Crucially, defense lives in the memory/semiotic layer, NOT in σ/Δ: the kernel
 * transition function is unchanged. A synonym-attack (e.g. "ship_to_production"
 * for "deploy_to_prod") is defeated because recall resolves the alias to the
 * canonical blocked action and returns the queried alias as blocked — so the
 * existing `blockedActions.includes(tool)` check in the kernel fires.
 */

import type { GatePolicy } from "./policy"
import type { CrystallineRecall, RecallResult } from "./crystalline"

export type MemoryLayer = "episodic" | "semantic" | "procedural" | "analogical" | "principle"

export interface MemoryEntry {
  id: string
  layer: MemoryLayer
  summary: string
  /** Free-form tags for retrieval (semantic clustering). */
  tags?: string[]
}

/** Principle memory: the active constraints (the I_bad set + mandatory SOP). */
export interface PrincipleMemory extends MemoryEntry {
  layer: "principle"
  blockedActions: string[]
  requiredSOP: string[]
}

/**
 * Semiotic link: a directed mapping from an alias term to a canonical action.
 * `relation` records why they are linked (for explainability / audit).
 */
export interface SemioticLink {
  alias: string
  canonical: string
  relation: "synonym" | "hypernym" | "instance-of" | "paraphrase"
  /** Link strength in [0, 1]; lowers recall confidence for weak links. */
  weight?: number
}

/** Episodic memory: a past precedent (action → outcome) for analogical recall. */
export interface EpisodicMemory extends MemoryEntry {
  layer: "episodic"
  action: string
  outcome: "BLOCKED" | "SUCCESS" | "ROLLBACK" | "PROCEED"
}

export interface CrystallineMemoryConfig {
  policy: GatePolicy
  /** Semiotic links resolving aliases → canonical actions. */
  semioticLinks?: SemioticLink[]
  /** Episodic precedents seeded into memory. */
  episodes?: EpisodicMemory[]
  /** Extra semantic/procedural/analogical notes surfaced as principles. */
  notes?: MemoryEntry[]
}

export interface RichRecallResult extends RecallResult {
  /** Layer entries that contributed to this recall (for audit / interrupts). */
  memories: MemoryEntry[]
  /** If the queried action was an alias, the canonical it resolved to. */
  resolvedCanonical?: string
}

/** Normalize an action token for alias matching (case/sep-insensitive). */
function normalize(token: string): string {
  return token.toLowerCase().replace(/[\s-]+/g, "_")
}

/**
 * Five-layer Crystalline memory implementing CrystallineRecall.
 *
 * On recall(action):
 *  1. PRINCIPLE layer supplies the base blockedActions + requiredSOP.
 *  2. SEMIOTIC layer resolves the queried action through alias links; if it (or
 *     its canonical) is forbidden, the queried alias is added to blockedActions
 *     so the kernel's default-deny shield fires on the synonym.
 *  3. EPISODIC/ANALOGICAL layers attach precedent context to the recall.
 *  4. confidence reflects the weakest semiotic link traversed (pessimistic).
 */
export class CrystallineMemory implements CrystallineRecall {
  private readonly principle: PrincipleMemory
  private readonly blocked: Set<string>
  private readonly aliasIndex = new Map<string, SemioticLink>()
  private readonly episodes: EpisodicMemory[]
  private readonly notes: MemoryEntry[]

  constructor(config: CrystallineMemoryConfig) {
    const { policy } = config
    this.principle = {
      id: `principle:${policy.gate}`,
      layer: "principle",
      summary: `Active constraints for ${policy.gate}`,
      blockedActions: [...policy.blockedActions],
      requiredSOP: [...policy.sopTools],
    }
    this.blocked = new Set(policy.blockedActions.map(normalize))
    this.episodes = config.episodes ? [...config.episodes] : []
    this.notes = config.notes ? [...config.notes] : []

    for (const link of config.semioticLinks ?? []) {
      this.aliasIndex.set(normalize(link.alias), link)
    }
  }

  /** Register a new semiotic link after construction (e.g. runtime policy update). */
  addSemioticLink(link: SemioticLink): void {
    this.aliasIndex.set(normalize(link.alias), link)
  }

  /** Resolve a token through semiotic links to its canonical action (1 hop). */
  private resolve(action: string): { canonical: string; link?: SemioticLink } {
    const link = this.aliasIndex.get(normalize(action))
    if (link) return { canonical: link.canonical, link }
    return { canonical: action }
  }

  async recall(action: string): Promise<RichRecallResult> {
    const principles = [this.principle.summary, ...this.notes.map((n) => n.summary)]
    const memories: MemoryEntry[] = [this.principle, ...this.notes]

    // Base blocked set (queried via canonical form too).
    const blockedActions = [...this.principle.blockedActions]
    const { canonical, link } = this.resolve(action)
    let confidence = 1
    let resolvedCanonical: string | undefined

    const canonicalIsBlocked = this.blocked.has(normalize(canonical))
    const aliasIsBlocked = this.blocked.has(normalize(action))

    if (link && canonicalIsBlocked && !aliasIsBlocked) {
      // Synonym-attack defense: the alias resolves to a forbidden action.
      blockedActions.push(action)
      resolvedCanonical = canonical
      confidence = link.weight ?? 1
      principles.push(
        `Semiotic link: '${action}' is a ${link.relation} of forbidden '${canonical}' — default-deny.`,
      )
      memories.push({
        id: `semiotic:${normalize(action)}`,
        layer: "semantic",
        summary: `'${action}' → '${canonical}' (${link.relation})`,
      })
    }

    // Attach episodic precedents for this action (analogical recall).
    const precedents = this.episodes.filter(
      (e) => normalize(e.action) === normalize(action) || normalize(e.action) === normalize(canonical),
    )
    for (const p of precedents) {
      memories.push(p)
      principles.push(`Precedent: '${p.action}' previously resulted in ${p.outcome}.`)
    }

    return {
      blockedActions,
      principles,
      confidence,
      memories,
      ...(resolvedCanonical ? { resolvedCanonical } : {}),
    }
  }
}

/** Convenience factory mirroring createPolicyRecall, with semiotic links. */
export function createCrystallineMemory(config: CrystallineMemoryConfig): CrystallineMemory {
  return new CrystallineMemory(config)
}
