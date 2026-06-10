import { createHash } from "node:crypto";

import { createAvatar, type Style } from "@dicebear/core";
import {
  adventurerNeutral,
  botttsNeutral,
  loreleiNeutral,
  notionistsNeutral,
  personas,
  shapes
} from "@dicebear/collection";
import {
  DICEBEAR_AVATAR_ROUTE_VERSION,
  DICEBEAR_AVATAR_STYLES,
  type DiceBearAvatarStyle
} from "@agenthub/protocol/avatars";

export type DiceBearAvatarRequest = {
  readonly style: DiceBearAvatarStyle;
  readonly seed: string;
};

export type RenderedAvatar = {
  readonly svg: string;
  readonly etag: string;
};

const MAX_SEED_LENGTH = 160;
const MAX_CACHE_ENTRIES = 256;
export const AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable";

const styles = {
  "adventurer-neutral": adventurerNeutral,
  "bottts-neutral": botttsNeutral,
  "lorelei-neutral": loreleiNeutral,
  "notionists-neutral": notionistsNeutral,
  personas,
  shapes
} satisfies Record<DiceBearAvatarStyle, unknown>;

const renderedCache = new Map<string, RenderedAvatar>();

export function parseDiceBearAvatarPath(pathname: string): DiceBearAvatarRequest | "invalid" | undefined {
  const match = new RegExp(`^/avatars/dicebear/${DICEBEAR_AVATAR_ROUTE_VERSION}/([^/]+)/([^/]+)\\.svg$`, "u").exec(pathname);
  if (match === null) return undefined;
  const style = match[1];
  const encodedSeed = match[2];
  if (!isDiceBearAvatarStyle(style) || encodedSeed === undefined) return "invalid";
  try {
    const seed = decodeURIComponent(encodedSeed);
    if (seed.length === 0 || seed.length > MAX_SEED_LENGTH) return "invalid";
    return { style, seed };
  } catch {
    return "invalid";
  }
}

export function renderDiceBearAvatar(request: DiceBearAvatarRequest): RenderedAvatar {
  const key = `${request.style}:${request.seed}`;
  const cached = renderedCache.get(key);
  if (cached !== undefined) return cached;
  const avatar = createAvatar(styleFor(request.style), {
    seed: request.seed,
    size: 96,
    radius: 50,
    backgroundColor: [backgroundColorForSeed(request.seed)],
    randomizeIds: false
  }).toString();
  const rendered = {
    svg: avatar,
    etag: `"${sha256(`${key}:${avatar}`).slice(0, 32)}"`
  };
  renderedCache.set(key, rendered);
  if (renderedCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = renderedCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) renderedCache.delete(oldestKey);
  }
  return rendered;
}

export function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;
  return ifNoneMatch.split(",").map((value) => value.trim()).includes(etag);
}

function isDiceBearAvatarStyle(value: string | undefined): value is DiceBearAvatarStyle {
  return DICEBEAR_AVATAR_STYLES.includes(value as DiceBearAvatarStyle);
}

function styleFor(style: DiceBearAvatarStyle): Style<Record<string, unknown>> {
  return styles[style] as Style<Record<string, unknown>>;
}

function backgroundColorForSeed(seed: string): string {
  const palette = [
    "dbeafe",
    "dcfce7",
    "fef3c7",
    "fce7f3",
    "ede9fe",
    "ccfbf1",
    "fee2e2",
    "e0e7ff"
  ];
  const digest = sha256(seed);
  const index = Number.parseInt(digest.slice(0, 2), 16) % palette.length;
  return palette[index] ?? palette[0]!;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
