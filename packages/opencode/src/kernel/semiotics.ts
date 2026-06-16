/**
 * Semiotic link table for the live gate.
 *
 * Maps common synonyms / paraphrases of forbidden actions back to their
 * canonical blocked form. This is the synonym-attack defense: a planner that
 * proposes "ship_to_production" instead of "deploy_to_prod" is resolved to the
 * canonical forbidden action by Crystalline recall, so the kernel's default-deny
 * shield still fires. Defense lives in the memory/semiotic layer — σ/Δ unchanged.
 */

import type { SemioticLink } from "../../../kernel/src/index"

export const SEMIOTIC_LINKS: SemioticLink[] = [
  // deploy_to_prod aliases
  { alias: "ship_to_production", canonical: "deploy_to_prod", relation: "synonym" },
  { alias: "go_live", canonical: "deploy_to_prod", relation: "paraphrase", weight: 0.8 },
  { alias: "push_to_prod", canonical: "deploy_to_prod", relation: "synonym" },
  { alias: "release_to_production", canonical: "deploy_to_prod", relation: "synonym" },
  { alias: "promote_to_prod", canonical: "deploy_to_prod", relation: "synonym" },

  // force_publish aliases
  { alias: "force_release", canonical: "force_publish", relation: "synonym" },
  { alias: "override_publish", canonical: "force_publish", relation: "synonym" },

  // execute_bash aliases
  { alias: "run_shell", canonical: "execute_bash", relation: "synonym" },
  { alias: "run_command", canonical: "execute_bash", relation: "synonym" },
  { alias: "shell_exec", canonical: "execute_bash", relation: "synonym" },

  // trigger_pipeline aliases
  { alias: "start_pipeline", canonical: "trigger_pipeline", relation: "synonym" },
  { alias: "kick_off_ci", canonical: "trigger_pipeline", relation: "paraphrase", weight: 0.8 },

  // delete_resource aliases
  { alias: "destroy_resource", canonical: "delete_resource", relation: "synonym" },
  { alias: "remove_resource", canonical: "delete_resource", relation: "synonym" },
]
