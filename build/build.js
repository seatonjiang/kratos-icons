import svgtofont from "svgtofont";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ejs from "ejs";
import esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const svgsDir = path.resolve(rootDir, "svgs");
const tempSvgsDir = path.resolve(rootDir, "temp");

// 读取 Unicode 映射文件
const unicodeMapPath = path.resolve(rootDir, "build/unicode-map.json");
let unicodeMap = {};
if (fs.existsSync(unicodeMapPath)) {
  try {
    unicodeMap = JSON.parse(fs.readFileSync(unicodeMapPath, "utf-8"));
  } catch (e) {
    console.warn("[警告] 无法解析映射文件");
  }
}

// 遍历目录中所有文件
const getFiles = (dir) => {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const files = dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  });
  return Array.prototype.concat(...files);
};

// 自动维护 Unicode 映射表
const maintainUnicodeMap = (svgFiles) => {
  const currentIcons = new Set(svgFiles.map((f) => path.basename(f, ".svg")));
  let hasChanges = false;

  // 删除不存在的图标
  Object.keys(unicodeMap).forEach((key) => {
    if (!currentIcons.has(key)) {
      delete unicodeMap[key];
      hasChanges = true;
    }
  });

  // 收集已使用的 Unicode
  const usedUnicodes = new Set(
    Object.values(unicodeMap).map((hex) => parseInt(hex, 16)),
  );

  // 为新图标分配 Unicode
  let nextUnicode = 0xea01;

  currentIcons.forEach((icon) => {
    if (!unicodeMap[icon]) {
      // 寻找下一个可用的 Unicode
      while (usedUnicodes.has(nextUnicode)) {
        nextUnicode++;
      }
      const hex = nextUnicode.toString(16);
      unicodeMap[icon] = hex;
      usedUnicodes.add(nextUnicode);
      hasChanges = true;
    }
  });

  // 如果有变更，保存文件
  if (hasChanges) {
    // 按 key 排序
    const sortedMap = Object.keys(unicodeMap)
      .sort()
      .reduce((obj, key) => {
        obj[key] = unicodeMap[key];
        return obj;
      }, {});

    // 更新内存中的 map
    unicodeMap = sortedMap;

    fs.writeFileSync(
      unicodeMapPath,
      JSON.stringify(sortedMap, null, 2) + "\n",
      "utf-8",
    );

    console.log("[提示] 正在更新 Unicode 映射表");
  }
};

async function build() {
  // 遍历 svgs 目录
  if (fs.existsSync(tempSvgsDir)) {
    fs.rmSync(tempSvgsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempSvgsDir);

  const allFiles = getFiles(svgsDir);
  const svgFiles = allFiles.filter((f) => f.endsWith(".svg"));

  console.log(`[提示] 扫描到 ${svgFiles.length} 个图标文件`);

  // 维护 Unicode 映射表
  maintainUnicodeMap(svgFiles);

  svgFiles.forEach((file) => {
    const filename = path.basename(file);
    fs.copyFileSync(file, path.join(tempSvgsDir, filename));
  });

  try {
    // 生成字体文件
    console.log("[提示] 正在生成字体文件");

    await svgtofont({
      log: false,
      src: tempSvgsDir,
      dist: "webfonts",
      emptyDist: true,
      styleTemplates: path.resolve(rootDir, "build/template"),
      classNamePrefix: "ks",
      fontName: "kratos-icons",
      css: {
        output: path.resolve(rootDir, "css"),
      },
      startUnicode: 0xea01,
      svgicons2svgfont: {
        fontName: "kratos-icons",
        fontHeight: 1000,
        normalize: true,
      },
      getIconUnicode: (name, unicode, startUnicode) => {
        if (unicodeMap[name]) {
          const fixedUnicode = String.fromCodePoint(
            parseInt(unicodeMap[name], 16),
          );
          return [fixedUnicode, startUnicode];
        }
        return [unicode, startUnicode + 1];
      },
      excludeFormat: ["eot", "svg", "symbol.svg"],
      website: null,
    });

    // 压缩 CSS 文件
    console.log("[提示] 正在压缩 CSS 文件");
    const cssPath = path.resolve(rootDir, "css/kratos-icons.css");
    const minCssPath = path.resolve(rootDir, "css/kratos-icons.min.css");

    await esbuild.build({
      entryPoints: [cssPath],
      outfile: minCssPath,
      minify: true,
    });

    // 生成演示页面
    console.log("[提示] 正在生成演示页面");
    const demoTemplate = fs.readFileSync(
      path.resolve(rootDir, "build/index.ejs"),
      "utf-8",
    );
    const demoHtml = ejs.render(demoTemplate, {
      pageTitle: "Kratos 矢量图标库",
      cssHref: "../css/kratos-icons.min.css",
      baseClass: "ks",
      glyphs: svgFiles.map((file) => ({
        name: "ks-" + path.basename(file, ".svg"),
      })),
    });

    fs.writeFileSync(path.resolve(rootDir, "demo/index.html"), demoHtml);
  } catch (e) {
    console.error("[失败] 构建过程出错：", e);
    process.exit(1);
  } finally {
    console.log("[成功] 矢量图标库构建完成");
    // 清理临时目录
    if (fs.existsSync(tempSvgsDir)) {
      fs.rmSync(tempSvgsDir, { recursive: true, force: true });
    }
  }
}

build();
