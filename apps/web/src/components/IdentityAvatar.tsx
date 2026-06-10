import { useEffect, useState } from "react";
import { initials } from "../lib/format.ts";

type IdentityAvatarProps = {
  readonly name: string;
  readonly avatarUrl?: string | undefined;
  readonly size?: "sm" | "md" | "lg" | undefined;
  readonly className?: string | undefined;
  readonly imageClassName?: string | undefined;
  readonly fallbackClassName?: string | undefined;
};

export function IdentityAvatar({ name, avatarUrl, size, className, imageClassName, fallbackClassName }: IdentityAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = avatarUrl !== undefined && avatarUrl.length > 0 && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <span className={classes("ah-identity-avatar", `ah-identity-avatar--${size ?? "md"}`, className)} aria-label={name} title={name}>
      {showImage ? (
        <img
          alt={name}
          className={classes("ah-identity-avatar-image", imageClassName)}
          onError={() => setImageFailed(true)}
          src={avatarUrl}
        />
      ) : (
        <span className={classes("ah-identity-avatar-fallback", fallbackClassName)} aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

function classes(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => value !== undefined && value.length > 0).join(" ");
}
