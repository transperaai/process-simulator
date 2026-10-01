// When Restore must ask first (issue #119, A54). `restore_version` decides from the draft's steps and edges only, and
// replacing a draft deletes its first principles with it. So when the draft's answers differ from live's, the app
// asks ("replace your unpublished changes?") before calling it, as it does for steps.

/** True when restoring must be answered with the "draft has changes" prompt instead of calling `restore_version`. */
export function mustAskBeforeRestore(replaceDraft: boolean, hasDraft: boolean, firstPrinciplesDiffer: boolean): boolean {
  return !replaceDraft && hasDraft && firstPrinciplesDiffer;
}
