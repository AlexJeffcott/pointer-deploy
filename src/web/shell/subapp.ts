// The one thing a sub-app must provide. Its own file, and deliberately nothing
// else in it: this type is half the contract every sub-app is compiled against,
// so anything sharing the file would mint a new contract whenever it changed.

export type SubApp = {
  /** Renders into el. Returns a function that removes what it rendered. */
  mount(el: HTMLElement): () => void;
};
