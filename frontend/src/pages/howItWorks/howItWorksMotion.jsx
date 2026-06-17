const motionProps = new Set(["initial", "whileInView", "viewport", "transition", "animate"]);

function motionTag(Tag) {
  return function MotionTag(props) {
    const passthrough = {};
    Object.entries(props).forEach(([key, value]) => {
      if (!motionProps.has(key)) passthrough[key] = value;
    });
    return <Tag {...passthrough} />;
  };
}

export const motion = {
  article: motionTag("article"),
  div: motionTag("div"),
  p: motionTag("p"),
  path: motionTag("path"),
  span: motionTag("span"),
  svg: motionTag("svg"),
};

export function MotionConfig({ children }) {
  return <>{children}</>;
}

export const ease = [0.22, 1, 0.36, 1];

export const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.16 },
  transition: { duration: 0.65, ease },
};
