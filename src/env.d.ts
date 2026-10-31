// Skills are embedded as text (import ... with { type: "text" }).
declare module "*.md" {
    const text: string;
    export default text;
}
