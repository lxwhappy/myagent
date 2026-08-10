# MyAgent 视觉设计规范

## Style Prompt
Modern, developer-focused, dark theme with clean typography and subtle technical aesthetics. Minimal motion, high contrast, code-forward presentation.

## Colors

### Primary Palette
| Role | Hex | Usage |
|------|-----|-------|
| Background | `#1a1a1a` | Main canvas background |
| Surface | `#242424` | Cards, panels, containers |
| Border | `#333333` | Dividers, outlines |
| Accent | `#e07855` | Call-to-actions, highlights, active states |
| Text Primary | `#e0e0e0` | Headings, body text |
| Text Secondary | `#888888` | Captions, metadata |
| Code Background | `#1e1e1e` | Code blocks, terminal |
| Success | `#10b981` | Positive feedback, success states |
| Warning | `#f59e0b` | Warnings, attention |
| Error | `#ef4444` | Errors, critical states |

### Color Rules
- Never use pure black (#000) or pure white (#fff)
- Accent color used sparingly for emphasis
- Text on surface backgrounds must maintain 4.5:1 contrast ratio
- Code blocks use dark monospace-friendly background

## Typography

### Font Families
| Context | Font Family |
|---------|-------------|
| Headings | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| Body | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif` |
| Code | `"SF Mono", "JetBrains Mono", "Fira Code", "Consolas", monospace` |

### Type Scale
| Element | Size | Weight | Line Height |
|---------|------|--------|-------------|
| H1 | 48px | 600 | 1.2 |
| H2 | 36px | 600 | 1.3 |
| H3 | 24px | 500 | 1.4 |
| Body | 16px | 400 | 1.6 |
| Caption | 14px | 400 | 1.5 |
| Code | 14px | 400 | 1.5 |

### Typography Rules
- Headings use semibold weight
- Body text uses regular weight
- Code maintains monospace family at 14px minimum
- Line height 1.5-1.6 for readability

## Spacing
| Scale | Value | Usage |
|-------|-------|-------|
| XS | 4px | Tight elements, borders |
| S | 8px | Related elements |
| M | 16px | Default spacing |
| L | 24px | Section separation |
| XL | 32px | Major sections |
| XXL | 48px | Page margins |

## Motion
| Property | Duration | Easing |
|----------|----------|--------|
| Fade In | 0.4s | ease-out |
| Fade Out | 0.3s | ease-in |
| Slide | 0.5s | cubic-bezier(0.4, 0, 0.2, 1) |
| Scale | 0.3s | ease-out |
| Typewriter | 0.03s per char | linear |

## What NOT to Do

1. **Avoid gradient backgrounds** - Use solid colors only
2. **Avoid drop shadows** - Flat design preferred
3. **Avoid rounded corners larger than 8px** - Keep it technical
4. **Avoid bright neon colors** - Stick to muted accent tones
5. **Avoid excessive motion** - Keep animations purposeful and minimal
6. **Avoid cartoonish or playful fonts** - Use system fonts only
7. **Avoid mixed animations** - One element animation at a time