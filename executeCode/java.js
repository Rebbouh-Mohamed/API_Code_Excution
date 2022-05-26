const { spawn } = require("node:child_process"),
  path = require("path");

const runCode = async (codeFile, inputs) => {
  const timeout = 8;
  try {
    const output = await new Promise((resolve, reject) => {
      const codeExec = spawn("java", [
        `${path.join(__dirname, `../codes/${codeFile}`)}`,
      ]);
      let outputString = "",
        errorString = "";

      if (inputs) {
        codeExec.stdin.write(inputs);
        codeExec.stdin.end();
      }

      codeExec.stdout.on("data", (data) => {
        outputString += data.toString();
      });
      codeExec.stderr.on("data", (data) => {
        errorString += data.toString();
      });
      codeExec.on("exit", () => {
        if (errorString) reject(errorString);
        resolve(outputString);
      });

      setTimeout(() => {
        reject(
          `Error: Timed Out. Your code took too long to execute, over ${timeout} seconds.`
        );
      }, timeout * 1000);
    });

    return { success: true, timestamp: new Date(), output };
  } catch (error) {
    return { success: false, timestamp: new Date(), error };
  }
};

const executeJava = async (codeFile, inputs) => {
  return await runCode(codeFile, inputs);
};

module.exports = {
  executeJava,
};