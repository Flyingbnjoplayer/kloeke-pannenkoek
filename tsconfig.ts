{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "incremental": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "moduleDetection": "auto",
    "baseUrl": ".",
    "paths": {
      "@agent-trinity/*": ["packages/*/src"],
      "@/components/*": ["components/*"],
      "@/lib/*": ["lib/*"],
      "@/utils/*": ["utils/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"],
  "jsx": "preserve",
  "exclude": ["node_modules"]
}
