import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const sourceLogo = path.resolve(root, "../static/images/logo/log222o.png");
const assetRoot = path.resolve(root, "ios/App/App/Assets.xcassets");
const appIconDir = path.join(assetRoot, "AppIcon.appiconset");
const splashDir = path.join(assetRoot, "Splash.imageset");

async function renderContainedCanvas(size, innerRatio, background) {
  const innerSize = Math.round(size * innerRatio);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background,
    },
  })
    .composite([
      {
        input: await sharp(sourceLogo)
          .resize(innerSize, innerSize, { fit: "contain" })
          .png()
          .toBuffer(),
        gravity: "center",
      },
    ])
    .png()
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(sourceLogo)) {
    throw new Error(`Logo file not found: ${sourceLogo}`);
  }
  if (!fs.existsSync(assetRoot)) {
    throw new Error(`iOS assets directory not found: ${assetRoot}`);
  }

  fs.mkdirSync(appIconDir, { recursive: true });
  fs.mkdirSync(splashDir, { recursive: true });

  const icon = await renderContainedCanvas(1024, 0.74, {
    r: 255,
    g: 255,
    b: 255,
    alpha: 1,
  });
  fs.writeFileSync(path.join(appIconDir, "AppIcon-512@2x.png"), icon);
  fs.writeFileSync(
    path.join(appIconDir, "Contents.json"),
    `${JSON.stringify(
      {
        images: [
          {
            filename: "AppIcon-512@2x.png",
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
          },
        ],
        info: {
          author: "xcode",
          version: 1,
        },
      },
      null,
      2,
    )}\n`,
  );

  const splash = await renderContainedCanvas(2732, 0.36, {
    r: 255,
    g: 255,
    b: 255,
    alpha: 1,
  });
  for (const filename of [
    "splash-2732x2732.png",
    "splash-2732x2732-1.png",
    "splash-2732x2732-2.png",
  ]) {
    fs.writeFileSync(path.join(splashDir, filename), splash);
  }
  fs.writeFileSync(
    path.join(splashDir, "Contents.json"),
    `${JSON.stringify(
      {
        images: [
          {
            idiom: "universal",
            filename: "splash-2732x2732-2.png",
            scale: "1x",
          },
          {
            idiom: "universal",
            filename: "splash-2732x2732-1.png",
            scale: "2x",
          },
          {
            idiom: "universal",
            filename: "splash-2732x2732.png",
            scale: "3x",
          },
        ],
        info: {
          version: 1,
          author: "xcode",
        },
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
