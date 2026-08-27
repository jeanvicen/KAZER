import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: "https://mcp.vercel.com",
  description: "Manage projects, deployments, and env vars.",
  auth: connect("mcp.vercel.com/prj_n1brWZvCVqAhfybl4Ea6oHRuQpQ2"),
});
