// // import { Application, DefaultTheme } from "typedoc";

// // export function load(app) {
// //     console.log("LOADED MY THEME")
// //     app.renderer.defineTheme("myTheme", DefaultTheme);
// // }


// // import { Application, DefaultTheme, DefaultThemeRenderContext, JSX, PageEvent, Reflection } from "typedoc";

// // class MyThemeContext extends DefaultThemeRenderContext {
// //     // Important: If you use `this`, this function MUST be bound! Template functions
// //     // are free to destructure the context object to only grab what they care about.

// //     override footer = (context) => {
// //         return (
// //             <footer>
// //                 {context.hook("footer.begin", context)}
// //                 Copyright 2024
// //                 {context.hook("footer.end", context)}
// //             </footer>
// //         );
// //     };
// // }

// // class MyTheme extends DefaultTheme {
// //     getRenderContext(pageEvent: PageEvent<Reflection>) {
// //         return new MyThemeContext(this, pageEvent, this.application.options);
// //     }
// // }

// // export function load(app) {
// //     app.renderer.defineTheme("my-theme", MyTheme);
// // }

// import { Application, DefaultTheme, JSX, ReflectionKind } from "typedoc";

// class MyTheme extends DefaultTheme {
//   constructor(renderer: any) {
//     super(renderer);

//     // this.icons.chevronDown = () => (
//     //   <svg viewBox="0 0 24 24">
//     //     <path d="M6 9l6 6 6-6" stroke="currentColor" fill="none" stroke-width="2" />
//     //   </svg>
//     // );

//     // this.icons[ReflectionKind.Class] = () => (
//     //   <svg viewBox="0 0 24 24">
//     //     <rect width="24" height="24" fill="var(--color-ts-class)" />
//     //   </svg>
//     // );
//   }
// }

// export function load(app: any) {
//   app.renderer.defineTheme("my-theme", MyTheme);
// }

import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { Application, DefaultTheme, type Icons, JSX, ReflectionKind, type Renderer } from "typedoc";
import { Fresh } from "typedoc-theme-fresh"

const ICON_DIR = path.join(path.dirname(createRequire(import.meta.url).resolve("lucide-static/package.json")), "icons");

const ICONS: Record<string, { icon: string; stroke: string }> = {
    [ReflectionKind.Document]: { icon: "file-text", stroke: "var(--color-document)" },

    folder: { icon: "folder", stroke: "var(--color-document)" },
    search: { icon: "search", stroke: "var(--color-icon-text)" },
    menu: { icon: "menu", stroke: "var(--color-icon-text)" },
    chevronDown: { icon: "chevron-down", stroke: "var(--color-icon-text)" },
    anchor: { icon: "link", stroke: "currentColor" },

    alertNote: { icon: "info", stroke: "var(--color-alert-note)" },
    alertTip: { icon: "lightbulb", stroke: "var(--color-alert-tip)" },
    alertImportant: { icon: "megaphone", stroke: "var(--color-alert-important)" },
    alertWarning: { icon: "triangle-alert", stroke: "var(--color-alert-warning)" },
    alertCaution: { icon: "octagon-alert", stroke: "var(--color-alert-caution)" },
};

function lucideIcon(name: string, stroke: string, baseProps: Record<string, unknown>,): () => JSX.Element {
    const fileContent = fs.readFileSync(path.join(ICON_DIR, `${name}.svg`), "utf8");
    const innerContent = fileContent.slice(fileContent.indexOf(">") + 1, fileContent.lastIndexOf("</svg>"));
    const props = {
        ...baseProps,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke,
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
    };
    const element = JSX.createElement("svg", props, JSX.createElement(JSX.Raw, { html: innerContent }));
    return () => element;
}

export class MyTheme extends Fresh {
    constructor(...args: ConstructorParameters<typeof Fresh>) {
        super(...args);
        for (const [key, { icon, stroke }] of Object.entries(ICONS)) {
            const name = key as keyof Icons;
            const baseProps = this.icons[name].call(this.icons).props as Record<string, unknown>;
            this.icons[name] = lucideIcon(icon, stroke, baseProps ?? {});
        }
    }
}

export function load(app: Application) {
    app.renderer.defineTheme("my-theme", MyTheme);
}