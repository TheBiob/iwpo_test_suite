# IWPO Test Suite 0.1
This will run .iwpotest files in order to test for features in I Wanna Play Online.

## Commandline
    --help                  - Print this help
    --file <.iwpotest file> - Which .iwpotest file(s) to read and execute. Can be used multiple times and also supports wildcards like *.iwpotest. If a file is specified multiple times, it will only be run once.
    --iwpo-base-dir <dir>   - Sets the Iwpo directory to be copied and modified. Default: iwpo/ 
    --temp-dir <dir>        - Sets the Temporary directory to copy to. Default: temp/
    --keep, -k              - Keeps generated temporary directories
    --verbose, -v           - Enables verbose logging
    |extra stuff to add later|
    --max-paralell <num>    - How many tests are allowed to run at any one time. Default 1 (no multithreading)

## File Structure
    [configuration]
    name=
    folder=
    game=
    args[]=
    output=
    timeout=
    iwpo_timeout=
    is_gms=
    skip_execute=
    expected_error[]=
    
    [server_packages]
    0=TCP 01 01
    
    [events]
    $$event
    <gml code to run>

### Notes on nomenclature
- [name] are arguments referring to entries found in the .iwpotest file.
- \<name\> are arguments generated by the test suite.

## [configuration] section
| setting | info |
|-|-|
name         | optional. A name for the test. Default: name of test file.
folder       | The folder with the exe to test for. This folder will be copied to a temporary location where the actual commands will be executed. The folder should be relative to where the .iwpotest file is located
game         | The name of the exe to be converted.
args[]       | optional. Arguments to add to the iwpo command. One per line.
output       | The generated file that will be (note: this is the output file that iwpo.exe generates, you can not choose an arbitrary name here, usually this will be \<game\>_online.exe)
iwpo_timeout | How long (in seconds) iwpo is allowed to try and convert the game before the test suite aborts the process and fails the test. Default: 60. 0 means no timeout (not recommended)
timeout      | How long (in seconds) the output file is allowed to run before the test suite aborts the process and fails the test. Default: 60. 0 means no timeout (not recommended)
is_gms       | Whether or not the GMS part of the tool should be copied and modified or only the gm8 part.
skip_execute | Whether or not executing the output file should be skipped. If this is true, the test will succeed if the iwpo command exits with code 0 and the output file exists.
expected_error | optional. If an error in game_errors.log is expected, this can be used to specify the expected file content. The array will be joined by \n, trimmed and then compared to the trimmed game_errors.log. \r\n newlines in game_errors.log are automatically converted to \n

The arguments in the .iwpotest file **should not** contain the server= or --test-suite arguments as those will be generated and added by the test suite.
An iwpo call might look like the following: ``iwpo.exe [game] [arguments] server=localhost,1000,1001 --test-suite``

## [server_packages] section
The server_packages section contains a list of pre-made packets the server can send. The game executable can request the server to send one of those packages by calling the @ServerPackage(id) function.
The server will then respond with the corresponding package which the game can then process.  
The key can be any string that is allowed in a filename, the string is then parsed by the test suite and provided to the server as a response if requested.  
The value is parsed as follows:  
 - The first 3 characters have to be TCP and specify the protocol for this package. UDP is currently not supported.  
 - If the first character after a space is a digit, then it will read up until the next space and try to parse that as a number.  
    - If the block is 2 4 or 8 characters long, it will be parsed as a hexadecimal number.  
    - If the block cannot be parsed as a hexadecimal number, it will be parsed as a double and added as such.  
 - If the next character is a quote (") it will take everything up until the next quote and try and add that as a null terminated string to the buffer.  

The test suite will then save these messages as \<key\>.bin and server.js will read those out when requested.

    Example chat message:
    ; A chat message: id:u8, id:string, message:string
    chat=TCP 04 "testid" "Chat Message"
    ; "someone saved" message: id:u8, gravity:u8, name:string, x:i32, y:double, room:u16
    saved1=TCP 05 00 "test player" 00000000 100.0 0001

## [events] section  
Everything past this section is parsed as GML events and modify the GML files that IWPO applies.

The $$event marker defines what GML code to run when iwpo code is executed. [event] can be \<pre/post/test\>_\<iwpo script name\>. For example: $$pre_worldCreate or $$post_saveGame. The "test" section refers to events run in the test object, refer to the section "Online Test Object" for more information.  
IWPO will not set any variables that would normally require a user input like @name, @password or @race in this mode. Those should be set by the $$pre_worldCreate code.  
Everything after a (or up until the next) $$ marker will be copied into the relevant script that IWPO applies. IWPO's post processing will also be applied to this code so you can use @ for the __ONLINE_ placeholder, it is however recommended that you don't use #if's unless to check if they are what is expected for this game.

### Scripts
$$script_[name] events can be used to create scripts in the resulting executable. These scripts will be added using the GML Prefix so you can call them by prefixing them with an @ symbol.
As an example, this defines the LOAD script to be used in the $$test_Step event:

    $$script_LOAD
        // Load the game, the way the game does it
        sound_stop_all();
        saveGame(0);
        loadGame(0);

    $$test_Step
        @LOAD(); // Call load script


## Online Test Object
IWPO will also create a test object called "__ONLINE_TESTOBJ" which is created at the end of the worldCreate event. This object has a Game Begin and normal Step event.
It will also automatically create and preserve a ds_list in the variable "@vars" by loading the index from a file in Game Begin or creating a new list and saving that index in a file if it doesn't yet exist.
There will also be the "@vars_loaded" variable which will be true if @vars was loaded from a file, or false if it wasn't. Can be used to initialize variables in the list if it wasn't loaded.

To run code in these events the following events are available:
|Event|Info|
|-|-|
|$$test_Step     | The step event of the test object. This does not run in EndStep like the world event. The test object is always the last in the object list.|
|$$test_GameBegin | The Game Begin event of the test object. Runs after the test object's own Game Begin code.|

## Helper Scripts
|script|info|
|-|-|
@SERVER_EXPECT(package)                 | Tells the server to expect the next package to be some specified package.
@SERVER_RESPOND(package)                | Tells the server to send the current client some specified package.
@ASSERT(assertion, text, abort)         | Asserts that a condition is true. If \<assertion\> is not true then it will fail the test and print \<text\> in the log then abort if \<abort\> is true.
ASSERTEQ(expected, actual, text, abort) | Asserts that \<expected\> equals \<actual\>, if not it will fail the test and print "\<text\>: Expected '\<exected\>' but got '\<actual\>'" in the log, then abort if \<abort\> is true.
@PASS()                                 | Writes an "ok" result and then calls game_end(); It will not try to delete any potential temp files the game may have created. If this is necessary, do so before calling this script.

The output executable should create 2 files with the following purposes:
 - result.txt - "ok" if everything has passed or "fail" if some test condition was not met.
 - game_errors.log - A log of error messages. Gamemaker will also write this file if an error occured.

These two files are generally created by the @ASSERT and @SUCCESS helper scripts

## Execution
The test suite will execute things in the following order:
1. Copy the folder specified by [folder] to a temporary location
2. Copy iwpo to the temporary directory
   1. Modify the tool's GML files based on the information in the .iwpotest file
3. Run iwpo.exe with [game], [arguments] (if specified) and a generated tcp/udp port on localhost as the server argument as well as the --test-suite argument
4. If iwpo.exe fails or if the file specified by [output] does not exist -\> fail the test
   1. If skip_execute is set, succed the test
5. Run server.js with the generated tcp/udp ports on localhost
6. Execute [output].
   1. The output executable is now responsible for figuring out if features are working
   2. if the executable does not exit after [timeout] seconds -\> kill the process and fail the test
7. Query server.js for test results, if errors occurred -\> fail the test
8. Succeed test

On test fail/success:
1) Stop server.js if it's running
2) Delete temporary folders unless --keep is specified
