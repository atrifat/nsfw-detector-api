export default {
  testEnvironment: "jest-environment-node",
  transform: {
    "^.+\\.m?js$": [
      "babel-jest",
      {
        "rootMode": "upward"
      }
    ]
  },
  transformIgnorePatterns: [
    "/node_modules/(?!mime|form-data|await-to-js|js-sha256).*/"
  ],
  moduleFileExtensions: [
    "mjs",
    "js",
    "json",
    "node"
  ],
  testMatch: [
    "**/__tests__/e2e/**/*.mjs"
  ]
};