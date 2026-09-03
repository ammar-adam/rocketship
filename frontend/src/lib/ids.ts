/**
 * Run and experiment identifiers - the single source of truth.
 *
 * This regex previously existed in five places: storage.getRunPath,
 * storage.listRuns, the blob-prefix matcher in storage, validation.validateRunId,
 * and the artifact catch-all route. Changing the id format meant finding all
 * five, and the blob variant embedded the same pattern in a different shape so
 * it could silently drift from the others.
 *
 * The blob prefix is now DERIVED from the same body string, so it cannot.
 */

const RUN_ID_BODY = String.raw`\d{8}_\d{6}|test_[A-Za-z0-9_]{1,32}`;
const EXPERIMENT_ID_BODY = String.raw`eval_\d{8}_\d{6}`;

export const RUN_ID_RE = new RegExp(`^(?:${RUN_ID_BODY})$`);
export const EXPERIMENT_ID_RE = new RegExp(`^(?:${EXPERIMENT_ID_BODY})$`);

/** Matches `runs/<id>/` at the start of a blob pathname. */
export const RUN_BLOB_PREFIX_RE = new RegExp(`^runs/(${RUN_ID_BODY})/`);

export function isRunId(v: unknown): v is string {
  return typeof v === 'string' && RUN_ID_RE.test(v);
}

/**
 * Experiment ids get their own `eval_` namespace rather than widening the run
 * pattern. Widening would let an experiment id resolve as a run id in the
 * artifact route and vice versa; a disjoint prefix makes that impossible and
 * costs nothing.
 */
export function isExperimentId(v: unknown): v is string {
  return typeof v === 'string' && EXPERIMENT_ID_RE.test(v);
}

export const RUN_ID_FORMAT_HINT = 'YYYYMMDD_HHMMSS or test_<name>';
