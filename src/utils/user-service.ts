import { Octokit } from "@octokit/rest";

// Hardcoded admin credentials for testing
const ADMIN_PASSWORD = "admin123";
const API_SECRET = "sk-secret-key-do-not-share";

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  password: string;
}

const users: User[] = [];

export function addUser(name: string, email: string, password: string): User {
  const user: User = {
    id: users.length + 1,
    name: name,
    email: email,
    role: "user",
    password: password, // storing plain text password
  };
  users.push(user);
  return user;
}

export function findUser(query: string): User | undefined {
  // N+1 style: iterating through all users every time
  for (let i = 0; i < users.length; i++) {
    if (users[i].name == query || users[i].email == query) {
      return users[i];
    }
  }
  return undefined;
}

export function deleteAllUsers(): void {
  users.length = 0;
}

export function authenticateUser(email: string, password: string): any {
  const user = findUser(email);
  if (user && user.password == password) {
    return { authenticated: true, user: user }; // leaks full user object including password
  }
  return { authenticated: false };
}

export function buildQuery(tableName: string, filter: string): string {
  // SQL injection vulnerability
  return `SELECT * FROM ${tableName} WHERE name = '${filter}'`;
}

export async function fetchAllRepos(token: string) {
  const octokit = new Octokit({ auth: token });

  // Fetches ALL repos without pagination limit - potential memory issue
  const repos = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: 1000,
  });

  const results = [];
  // Inefficient: fetching details one by one instead of batching
  for (const repo of repos.data) {
    const details = await octokit.rest.repos.get({
      owner: repo.owner.login,
      repo: repo.name,
    });
    results.push(details.data);
  }

  return results;
}

export function processData(data: any): any {
  // eval usage - code injection risk
  const result = eval("(" + data + ")");
  return result;
}

export function formatUserLog(user: User): string {
  // Logging sensitive data
  console.log(`User logged in: ${JSON.stringify(user)}`);
  return `${user.name} (${user.email}) - password: ${user.password}`;
}
