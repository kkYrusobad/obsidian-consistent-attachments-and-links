import { App, Plugin, TAbstractFile, TFile, EmbedCache, LinkCache } from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, SettingTab } from './settings';
import { Utils } from './utils';

const path = require('path');



interface LinkChangeInfo {
	oldPath: string,
	newPath: string
}

export default class MoveNoteWithAttachments extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new SettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => this.proceedMovedFile(file, oldPath)),
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => this.deleteNoteAttachments(file)),
		);
	}

	deleteNoteAttachments(file: TAbstractFile) {
		//todo
	}

	async proceedMovedFile(noteFile: TAbstractFile, oldNotePath: string) {

		let fileExt = oldNotePath.substring(oldNotePath.lastIndexOf("."));
		if (fileExt == ".md") {

			let newNotePath = noteFile.path;

			await Utils.delay(500);//waiting for move note
			await this.moveNoteAttachments(oldNotePath, newNotePath)
			await this.updateInternalLinksInMovedNote(oldNotePath, newNotePath)
			await this.updateBacklinksToModedNote(oldNotePath, newNotePath)
			//todo: delete empty folders
		}
	}

	async moveNoteAttachments(oldNotePath: string, newNotePath: string) {
		let renamedFiles: LinkChangeInfo[] = [];

		let embeds = this.app.metadataCache.getCache(newNotePath)?.embeds; //wait to metadataCache update before call it

		if (embeds) {
			for (let embed of embeds) {
				let link = embed.link;

				let file = this.getFileByLink(link, oldNotePath);
				if (!file) {
					console.error("Move Note With Attachments: " + oldNotePath + " has bad link (file does not exist): " + link);
					continue;
				}

				await this.createFolderForAttachment(link, newNotePath);
				let newFullPath = this.getFullPathForLink(link, newNotePath);


				// just moved note will have unresolved links to embeds, so it will not have any valid backlinks 
				let linkedNotes = this.getNotesThatHaveLinkToFile(file.path);

				if (this.settings.deleteFilesWhenExist) {
					//if no other file has link to this file
					if (linkedNotes.length == 0) {
						//move file. if file already exist at new location - just delete the old one
						let existFile = this.getFileByPath(newFullPath);
						if (!existFile) {
							console.log("Move Note With Attachments: move file [from, to]: \n   " + file.path + "\n   " + newFullPath)
							await this.app.vault.rename(file, newFullPath);
						} else {
							console.log("Move Note With Attachments: delete file: \n   " + file.path)
							await this.app.vault.trash(file, true);
						}
					}
					//if some other file has link to this file
					else {
						//copy file. if file already exist at new location - do nothing
						let existFile = this.getFileByPath(newFullPath);
						if (!existFile) {
							console.log("Move Note With Attachments: copy file [from, to]: \n   " + file.path + "\n   " + newFullPath)
							await this.app.vault.copy(file, newFullPath);
						}
					}
				} else {
					//if no other file has link to this file
					if (linkedNotes.length == 0) {
						//move file. if file already exist at new location - copy file with new name
						let existFile = this.getFileByPath(newFullPath);
						if (!existFile) {
							console.log("Move Note With Attachments: move file [from, to]: \n   " + file.path + "\n   " + newFullPath)
							await this.app.vault.rename(file, newFullPath);
						} else {
							let newFileCopyName = this.generateFileCopyName(newFullPath)
							console.log("Move Note With Attachments: copy file with new name [from, to]: \n   " + file.path + "\n   " + newFileCopyName)
							await this.app.vault.copy(file, newFileCopyName);
							renamedFiles.push({ oldPath: newFullPath, newPath: newFileCopyName })
						}
					}
					//if some other file has link to this file
					else {
						//copy file. if file already exist at new location - copy file with new name
						let existFile = this.getFileByPath(newFullPath);
						if (!existFile) {
							console.log("Move Note With Attachments: copy file (from to): \n   " + file.path + "\n   " + newFullPath)
							await this.app.vault.copy(file, newFullPath);
						} else {
							let newFileCopyName = this.generateFileCopyName(newFullPath)
							console.log("Move Note With Attachments: copy file with new name [from, to]: \n   " + file.path + "\n   " + newFileCopyName)
							await this.app.vault.copy(file, newFileCopyName);
							renamedFiles.push({ oldPath: newFullPath, newPath: newFileCopyName })
						}
					}
				}
			}

			if (renamedFiles.length > 0) {
				console.log(renamedFiles)
				await this.updateChangedLinksInNote(newNotePath, renamedFiles)
			}
		}
	}

	generateFileCopyName(originalName: string): string {
		let ext = path.extname(originalName);
		let baseName = path.basename(originalName, ext);
		let dir = path.dirname(originalName);
		for (let i = 1; i < 100000; i++) {
			let newName = dir + "/" + baseName + " " + i + ext;
			let existFile = this.getFileByPath(newName);
			if (!existFile)
				return newName;
		}
		return "";
	}

	async updateBacklinksToModedNote(oldNotePath: string, newNotePath: string) {
		let notes = this.getNotesThatHaveLinkToFile(oldNotePath);
		let changedLinks: LinkChangeInfo[] = [{ oldPath: oldNotePath, newPath: newNotePath }];

		for (let note of notes) {
			await this.updateChangedLinksInNote(note, changedLinks);
		}
	}

	async updateChangedLinksInNote(notePath: string, changedLinks: LinkChangeInfo[]) {
		let file = this.getFileByPath(notePath);
		if (!file) {
			console.error("Move Note With Attachments: " + "cant update links in note, file not found: " + notePath);
			return;
		}

		let text = await this.app.vault.read(file);
		let dirty = false;

		let elements = text.match(/\[.*?\)/g);
		if (elements != null && elements.length > 0) {
			for (let el of elements) {
				let alt = el.match(/\[(.*?)\]/)[1];
				let link = el.match(/\((.*?)\)/)[1];

				let fullLink = this.getFullPathForLink(link, notePath);

				for (let renamedFile of changedLinks) {
					if (fullLink == renamedFile.oldPath) {
						let newRelLink: string = path.relative(fullLink, renamedFile.newPath);
						newRelLink = Utils.normalizePathForLink(newRelLink);

						if (newRelLink.startsWith("../"))
							newRelLink = newRelLink.substring(3);

						console.log("Move Note With Attachments: link updated in note [note, old link, new link]: \n   "
							+ file.path + "\n   " + link + "   \n" + newRelLink)

						text = text.replace(el, '[' + alt + ']' + '(' + newRelLink + ')')
						dirty = true;
					}
				}
			}
		}

		if (dirty)
			await this.app.vault.modify(file, text);
	}





	async updateInternalLinksInMovedNote(oldNotePath: string, newNotePath: string) {
		let file = this.getFileByPath(newNotePath);
		if (!file) {
			console.error("Move Note With Attachments: " + "cant update internal links, file not found: " + newNotePath);
			return;
		}

		let text = await this.app.vault.read(file);
		let dirty = false;

		let elements = text.match(/\[.*?\)/g);
		if (elements != null && elements.length > 0) {
			for (let el of elements) {
				let alt = el.match(/\[(.*?)\]/)[1];
				let link = el.match(/\((.*?)\)/)[1];

				if (link.endsWith(".md")) {
					let fullLink = this.getFullPathForLink(link, oldNotePath);
					let newRelLink: string = path.relative(newNotePath, fullLink);
					newRelLink = Utils.normalizePathForLink(newRelLink);

					if (newRelLink.startsWith("../"))
						newRelLink = newRelLink.substring(3);

					console.log("Move Note With Attachments: link updated in note [note, old link, new link]: \n   "
						+ file.path + "\n   " + link + "   \n" + newRelLink)

					text = text.replace(el, '[' + alt + ']' + '(' + newRelLink + ')')
					dirty = true;
				}
			}
		}

		if (dirty)
			await this.app.vault.modify(file, text);
	}



	getNotesThatHaveLinkToFile(filePath: string): string[] {
		let notes: string[] = [];
		let allNotes = this.app.vault.getMarkdownFiles();


		for (let note of allNotes) {
			let notePath = note.path;

			// just moved note will have unresolved links to embeds, so it will don have any valid backlinks 
			// if you dont wait after note moved, it will have undefined embeds due to metadataCache update delay
			let embeds = this.app.metadataCache.getCache(notePath)?.embeds;

			if (embeds) {
				for (let embed of embeds) {
					let linkFullPath = this.getFullPathForLink(embed.link, notePath);
					if (linkFullPath == filePath) {
						if (!notes.contains(notePath))
							notes.push(notePath);
					}
				}
			}

			let links = this.app.metadataCache.getCache(notePath)?.links;
			if (links) {
				for (let link of links) {
					let linkFullPath = this.getFullPathForLink(link.link, notePath);
					if (linkFullPath == filePath) {
						if (!notes.contains(notePath))
							notes.push(notePath);
					}
				}
			}
		}

		return notes;
	}



	getAllEmbedsToFile(filePath: string): { [notePath: string]: EmbedCache[]; } {
		let allEmbeds: { [notePath: string]: EmbedCache[]; } = {};
		let notes = this.app.vault.getMarkdownFiles();

		for (let note of notes) {
			// just moved note will have unresolved links to embeds, so it will don have any valid backlinks 
			// if you dont wait after note moved, it will have undefined embeds due to metadataCache update delay
			let embeds = this.app.metadataCache.getCache(note.path)?.embeds;

			if (embeds) {
				for (let embed of embeds) {
					let linkFullPath = this.getFullPathForLink(embed.link, note.path);
					if (linkFullPath == filePath) {
						if (!allEmbeds[note.path])
							allEmbeds[note.path] = [];
						allEmbeds[note.path].push(embed);
					}
				}
			}
		}

		return allEmbeds;
	}

	getAllLinksToFile(filePath: string): { [notePath: string]: LinkCache[]; } {
		let allLinks: { [notePath: string]: LinkCache[]; } = {};
		let notes = this.app.vault.getMarkdownFiles();

		for (let note of notes) {
			// just moved note will have unresolved links to embeds, so it will don have any valid backlinks 
			// if you dont wait after note moved, it will have undefined embeds due to metadataCache update delay
			let links = this.app.metadataCache.getCache(note.path)?.links;

			if (links) {
				for (let link of links) {
					let linkFullPath = this.getFullPathForLink(link.link, note.path);
					if (linkFullPath == filePath) {
						if (!allLinks[note.path])
							allLinks[note.path] = [];
						allLinks[note.path].push(link);
					}
				}
			}
		}

		return allLinks;
	}


	async createFolderForAttachment(link: string, owningNotePath: string) {
		let newFullPath = this.getFullPathForLink(link, owningNotePath);
		let newParentFolder = newFullPath.substring(0, newFullPath.lastIndexOf("/"));
		try {
			//todo check filder exist
			await this.app.vault.createFolder(newParentFolder)
		} catch { }
	}

	getFullPathForLink(link: string, owningNotePath: string) {
		link = Utils.normalizePathForFile(link);
		owningNotePath = Utils.normalizePathForFile(owningNotePath);

		let parentFolder = owningNotePath.substring(0, owningNotePath.lastIndexOf("/"));
		let fullPath = path.join(parentFolder, link);

		fullPath = Utils.normalizePathForFile(fullPath);
		return fullPath;
	}

	getFileByLink(link: string, owningNotePath: string): TFile {
		let fullPath = this.getFullPathForLink(link, owningNotePath);
		let file = this.getFileByPath(fullPath);
		return file;
	}

	getFileByPath(path: string): TFile {
		path = Utils.normalizePathForFile(path);
		let files = this.app.vault.getFiles();
		let file = files.find(file => Utils.normalizePathForFile(file.path) === path);
		return file;
	}



	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}


}



