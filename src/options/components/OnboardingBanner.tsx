export type BannerVariant = "browse" | "api" | "browse-with-api" | null;

interface OnboardingBannerProps {
  variant: BannerVariant;
  onGoToSettings: () => void;
}

const TEXTS: Record<string, string> = {
  browse: "当前还没有你的学习记录。去浏览几篇英文网页，生词和难句会从这里开始积累。",
  api: "当前还没有你的学习记录。配置 API 后，掰 it 会把难句拆解成可复习的句式。",
  "browse-with-api": "当前还没有你的学习记录。去浏览几篇英文网页，掰 it 会自动记录你的生词和难句。",
};

export function OnboardingBanner({ variant, onGoToSettings }: OnboardingBannerProps) {
  if (!variant) return null;

  return (
    <div className="onboarding-banner">
      <div className="banner-text">{TEXTS[variant]}</div>
      {variant === "api" && (
        <button className="banner-link" onClick={onGoToSettings} type="button">
          去设置
        </button>
      )}
    </div>
  );
}
