const {commandMap, supportedLanguages} = require("./instructions")
const {createCodeFile} = require("../file-system/createCodeFile")
const {removeCodeFile} = require("../file-system/removeCodeFile")
const {info} = require("./info")

const {spawn} = require("child_process");

async function runCode({language = "", code = "", input = ""}) {
    const timeout = 10; // Reduced to 10 seconds to stay under 15s client timeout

    if (code === "")
        throw {
            status: 400,
            error: "No Code found to execute."
        }

    if (!supportedLanguages.includes(language))
        throw {
            status: 400,
            error: `Please enter a valid language. Check documentation for more details: https://github.com/Jaagrav/CodeX-API#readme. The languages currently supported are: ${supportedLanguages.join(', ')}.`
        }

    const {jobID} = await createCodeFile(language, code);
    const {compileCodeCommand, compilationArgs, executeCodeCommand, executionArgs, outputExt} = commandMap(jobID, language);

    // Compilation phase with timeout
    if (compileCodeCommand) {
        try {
            await new Promise((resolve, reject) => {
                const compileCode = spawn(compileCodeCommand, compilationArgs || []);
                let compileError = "";
                let compileOutput = "";
                let isResolved = false;

                // Compilation timeout (5 seconds)
                const compileTimer = setTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        compileCode.kill("SIGKILL");
                        reject({
                            status: 200,
                            output: "",
                            error: "Compilation timed out",
                            language,
                        });
                    }
                }, 5000);

                compileCode.stdout.on("data", (data) => {
                    compileOutput += data.toString();
                });

                compileCode.stderr.on("data", (data) => {
                    compileError += data.toString();
                });

                compileCode.on("error", (err) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(compileTimer);
                        reject({
                            status: 200,
                            output: "",
                            error: `Compilation error: ${err.message}`,
                            language,
                        });
                    }
                });

                compileCode.on("exit", (code) => {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(compileTimer);
                        
                        if (code !== 0) {
                            reject({
                                status: 200,
                                output: "",
                                error: compileError || compileOutput || "Compilation failed",
                                language,
                            });
                        } else {
                            resolve();
                        }
                    }
                });
            });
        } catch (compileResult) {
            // Compilation failed - clean up and return error
            await removeCodeFile(jobID, language, outputExt);
            return {
                ...compileResult,
                info: await info(language)
            };
        }
    }

    // Execution phase
    const result = await new Promise((resolve) => {
        let output = "";
        let error = "";
        let isResolved = false;

        if (!executeCodeCommand) {
            return resolve({
                output: "",
                error: "Executable not found"
            });
        }

        let executeCode;
        try {
            executeCode = spawn(executeCodeCommand, executionArgs || [], {
                timeout: timeout * 1000
            });
        } catch (err) {
            return resolve({
                output: "",
                error: `Runtime error: ${err.message}`
            });
        }

        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                try {
                    executeCode.kill("SIGKILL");
                } catch (e) {
                    // Process already dead
                }
                resolve({
                    output: output,
                    error: (error || "") + "\nExecution timed out after " + timeout + " seconds"
                });
            }
        }, timeout * 1000);

        // Handle spawn errors (ENOENT, EACCES, etc.)
        executeCode.on("error", (err) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timer);
                resolve({
                    output: "",
                    error: `Runtime error: ${err.message}`
                });
            }
        });

        // Write input if provided
        if (input !== "") {
            try {
                executeCode.stdin.write(input);
                executeCode.stdin.end();
            } catch (e) {
                // stdin might already be closed
            }
        } else {
            try {
                executeCode.stdin.end();
            } catch (e) {
                // stdin might already be closed
            }
        }

        executeCode.stdout.on("data", (data) => {
            output += data.toString();
        });

        executeCode.stderr.on("data", (data) => {
            error += data.toString();
        });

        executeCode.on("close", (code, signal) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timer);
                
                // If killed by signal, add info to error
                if (signal) {
                    error += `\nProcess terminated by signal: ${signal}`;
                }
                
                resolve({ output, error });
            }
        });
    });

    await removeCodeFile(jobID, language, outputExt);

    return {
        ...result,
        language,
        info: await info(language)
    }
}

module.exports = {runCode}