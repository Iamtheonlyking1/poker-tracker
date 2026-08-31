// First sign-in: work out whether to upload local data, adopt the cloud, or
// ask the user to choose. Pure enough to test; the UI drives the choice.

function hasLocalData(store) {
  for (const k of ['poker.history', 'poker.roster', 'poker.sessionlog', 'poker.structures', 'poker.customRanges']) {
    try {
      const a = JSON.parse(store.getRaw(k) || '[]');
      if (Array.isArray(a) && a.some((r) => r && !r.deletedAt)) return true;
    } catch (e) {
      /* ignore */
    }
  }
  const active = store.getRaw('poker.active');
  if (active && active !== 'null') {
    try {
      if ((JSON.parse(active).players || []).length) return true;
    } catch (e) {
      /* ignore */
    }
  }
  return false;
}

async function remoteHasData(backend) {
  try {
    const { docs } = await backend.pull('');
    return docs.some((d) => !d.deleted && d.kind !== 'prefs' && d.kind !== 'quiz');
  } catch (e) {
    return false; // offline — treat as empty; a later pull reconciles
  }
}

/**
 * Returns one of:
 *   'clean'    — nothing either side; just start
 *   'upload'   — local data, empty cloud; start (engine uploads it)
 *   'download' — empty local, cloud has data; start (engine pulls it)
 *   'choose'   — data on both sides; ask the user (merge vs replace-with-cloud)
 */
export async function classifyFirstSync(backend, store) {
  const local = hasLocalData(store);
  const remote = await remoteHasData(backend);
  if (local && remote) return 'choose';
  if (local) return 'upload';
  if (remote) return 'download';
  return 'clean';
}
