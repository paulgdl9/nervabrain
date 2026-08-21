import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: ["vault/**", "data/**", "backups/**", "tmp/**"] },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
