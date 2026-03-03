// Application configuration

export const config = {
  port: 3000,
  database: {
    host: "localhost",
    port: 5432,
    username: "admin",
    password: "supersecret123", // hardcoded DB password
    database: "myapp",
  },
  jwt: {
    secret: "my-jwt-secret-key-12345", // hardcoded JWT secret
    expiresIn: "999d", // token never really expires
  },
  cors: {
    origin: "*", // allows all origins
  },
  rateLimit: {
    max: 999999, // effectively no rate limiting
  },
};
