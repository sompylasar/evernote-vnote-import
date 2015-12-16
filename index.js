var fs = require('fs');

var Evernote = require('evernote').Evernote;

var developerToken = fs.readFileSync(__dirname + '/key.txt').toString().replace(/^\s*|\s*$/g, '');

var evernoteClient = new Evernote.Client({
  token: developerToken,
  sandbox: false
});

var evernoteNoteStore = evernoteClient.getNoteStore();

function storeEvernoteNote(noteStore, noteParams, parentNotebook) {
  return new Promise(function (resolve, reject) {
    // Create note object
    var note = new Evernote.Note();
    note.created = noteParams.created;
    note.updated = noteParams.updated || noteParams.created;
    note.title = noteParams.title;
    note.content = noteParams.content;

    // parentNotebook is optional; if omitted, default notebook is used
    if (parentNotebook && parentNotebook.guid) {
      note.notebookGuid = parentNotebook.guid;
    }

    // Attempt to create note in Evernote account
    noteStore.createNote(note, function (err, noteSaved) {
      if (err) {
        return reject(err);
      }
      resolve(note);
    });
  });
}

/**
BEGIN:VNOTE
VERSION:1.1
BODY;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Stocks=0D=0ANMG  gold =0D=0AA=
BY   Cu=0D=0AWSA nickel=0D=0ARDM  cu, au, misc
DCREATED:20110505T125800
LAST-MODIFIED:20110505T125842
END:VNOTE
*/
function convertVnoteStringToEvernoteNoteParams(vnoteContent) {
  return new Promise(function (resolve, reject) {
    var evernoteNoteParams = {
      created: Date.now(),
      updated: Date.now(),
      title: '',
      body: '',
      content: '',
    };
    
    function readToken(str, index, token) {
      str = str.slice(index);
      if (str.indexOf(token) !== 0) {
        throw new Error('Expected ' + JSON.stringify(token) + ', got ' + JSON.stringify(str));
      }
      return (index + token.length);
    }
    function readUntil(str, index, token) {
      do {
        if (str.slice(index, index + token.length) === token) {
          return index;
        }
        index += 1;
      } while (index < (str.length - 1 + token.length));
      throw new Error('Expected ' + JSON.stringify(token) + ', got EOF');
    }
    function decodeQuotedPrintable(quotedPrintable) {
      var ret = '';
      for (var i = 0, ic = quotedPrintable.length; i < ic; ++i) {
        var char = quotedPrintable.slice(i, i + 1);
        if (char === '=') {
          ret += String.fromCharCode(parseInt(quotedPrintable.slice(i + 1, i + 3), 16));
          i += 2;
        }
        else {
          ret += char;
        }
      }
      return ret;
    }
    function decodeVnoteDate(vnoteDateStr) {
      var dateTimezoneOffsetString = '+03:00';
      var date = new Date(vnoteDateStr.replace(/^([0-9]{4})([0-9]{2})([0-9]{2})[T]([0-9]{2})([0-9]{2})([0-9]{2})$/, '$1-$2-$3T$4:$5:$6' + dateTimezoneOffsetString));
      return date.getTime();
    }
    function convertToEvernoteMarkup(text) {
      return (
        // https://dev.evernote.com/doc/articles/enml.php
        // https://gist.github.com/evernotegists/5313752#file-plain-txt
        // https://gist.github.com/evernotegists/5313753#file-example-html
        ('<div>' + text.split(/\n/).join('</div><div>') + '</div>').replace(/<div><\/div>/g, '<div><br /></div>')
      );
    }
    function parseVnote(str) {
      var index = 0;
      var startIndex;
      
      index = readToken(str, index, 'BEGIN:VNOTE\n');
      index = readToken(str, index, 'VERSION:1.1\n');
      
      index = readToken(str, index, 'BODY;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:');
      startIndex = index;
      index = readUntil(str, index, '\n');
      var evernoteNoteBody = convertToEvernoteMarkup(decodeQuotedPrintable(str.slice(startIndex, index)));
      index = readToken(str, index, '\n');
      
      index = readToken(str, index, 'DCREATED:');
      startIndex = index;
      index = readUntil(str, index, '\n');
      evernoteNoteParams.created = decodeVnoteDate(str.slice(startIndex, index));
      index = readToken(str, index, '\n');
      
      index = readToken(str, index, 'LAST-MODIFIED:');
      startIndex = index;
      index = readUntil(str, index, '\n');
      evernoteNoteParams.updated = decodeVnoteDate(str.slice(startIndex, index));
      index = readToken(str, index, '\n');
      
      index = readToken(str, index, 'END:VNOTE\n');
      
      var evernoteNoteContentXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";
      evernoteNoteContentXml += "<!DOCTYPE en-note SYSTEM \"http://xml.evernote.com/pub/enml2.dtd\">";
      evernoteNoteContentXml += "<en-note>" + evernoteNoteBody + "</en-note>";
      evernoteNoteParams.content = evernoteNoteContentXml;
    }
    
    vnoteContent = vnoteContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '') + '\n';
    
    parseVnote(vnoteContent, 0);
    
    resolve(evernoteNoteParams);
  });
}

function readFilePromised(path) {
  return new Promise(function (resolve, reject) {
    fs.readFile(path, function (err, content) {
      if (err) {
        return reject(err);
      }
      resolve(content);
    });
  });
}

function readdirPromised(path) {
  return new Promise(function (resolve, reject) {
    fs.readdir(path, function (err, files) {
      if (err) {
        return reject(err);
      }
      resolve(files);
    });
  });
}

function run(path) {
  return (
    Promise.resolve()
      .then(function () {
        return readdirPromised(path);
      })
      .then(function (files) {
        files = [ files[0] ];
        return Promise.all(files.map(function (filename) {
          return (
            Promise.resolve()
              .then(function () {
                return readFilePromised(path + '/' + filename);
              })
              .then(function (fileContentBuffer) {
                return fileContentBuffer.toString('utf8');
              })
              .then(function (fileContent) {
                return convertVnoteStringToEvernoteNoteParams(fileContent);
              })
              .then(function (evernoteNoteParams) {
                evernoteNoteParams.title = filename;
                return storeEvernoteNote(evernoteNoteStore, evernoteNoteParams);
              })
              .then(function (evernoteNote) {
                console.log(filename + ' - Stored:', evernoteNote);
              })
              .catch(function (err) {
                console.error(filename + ' - Error:', err);
              })
          );
        }));
      })
      .then(function () {
        console.log('Done.');
      })
      .catch(function (err) {
        console.error('Error:', err);
      })
  );
}

var VNOTES_PATH = __dirname + '/_notes';
run(VNOTES_PATH);
