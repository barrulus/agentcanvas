{
  description = "AgentCanvas — provider-agnostic AI agent orchestrator";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        python = pkgs.python312;
        pythonEnv = python.withPackages (
          ps: with ps; [
            fastapi
            uvicorn
            pydantic
            httpx
            python-dotenv
            websockets
          ]
        );
      in
      {
        devShells.default = pkgs.mkShell {
          name = "agentcanvas-dev";

          buildInputs = [
            pythonEnv
            pkgs.nodejs_22
            pkgs.nodePackages.npm
            pkgs.git
            pkgs.curl
          ];

          shellHook = ''
            echo "AgentCanvas dev shell"
            echo "  Run:  bash run.sh"
            echo ""
          '';
        };
      }
    );
}
