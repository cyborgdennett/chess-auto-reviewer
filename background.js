// Unofficial chess.com auto game reviewer. 
//
// This will solve your problems with getting all games reviewed. 
// You have to be a chess.com member, otherwise you have very limited access to the review functionality.
//
// Right clicking in chess.com and pressing 'Review All Games' will open as many tabs as there are non-reviewed games.
// After analyzing, the tabs will be automatically closed.
//
// Becareful on toasters.
//
// (c) Casper Belier 2024

chrome.contextMenus.create({
  id: "reviewAll",
  title: "Review All Games",
  contexts: ["page"],
  documentUrlPatterns: ["https://www.chess.com/member/*","https://www.chess.com/games/archive/*","https://www.chess.com/games/*"]
});

function onRemoved() {
  console.log(`Removed`);
}

function onError(error) {
  console.log(`Error: ${error}`);
}

async function reviewAllGames(gameLinks) {
  if (gameLinks === null) return;
  if (gameLinks.length == 0) return;
  const activeTabIds = new Set();

  for (const link of gameLinks) {
    const gameTab = await chrome.tabs.create({ url: link, active: true });
    activeTabIds.add(gameTab.id);
    console.log(`made ${gameTab.id}`);

    // Listener to decrement activeTabCount when a tab closes
    chrome.tabs.onRemoved.addListener(function tabRemovedListener(tabId) {
      if (tabId === gameTab.id) {
        chrome.tabs.onRemoved.removeListener(tabRemovedListener);
        console.log("onRemoved", tabId);
        activeTabIds.delete(tabId);
      }
    });
    // Listener to know when an tab is finished analyzing
    // https://www.chess.com/analysis/game/live/75233371841?tab=review
    // it starts with tab=analysis when that is finished it will become tab=review.

    function tabUpdatedListener(tabId, changeInfo, tabInfo) {
      if (tabId === gameTab.id) {
        // check whether url has changed 
        if (changeInfo.url) {
          urlsplit = changeInfo.url.split("?");
          if (urlsplit[urlsplit.length - 1] == "tab=review") {
            function checkForRatingAndClose(retries = 0) {
              chrome.scripting.executeScript(
                {
                  target: { tabId: tabId },
                  func: () => {
                    const ratingElement = document.querySelector('.review-rating-component.review-rating-white span');
                    if (ratingElement) {
                      const ratingText = ratingElement.textContent.trim();

                      // Regular Expression to Match Numerical Value
                      const numberRegex = /^\d+(\.\d+)?$/; // Matches integers or decimals

                      // Check if ratingText matches the regex
                      if (ratingText !== '' && numberRegex.test(ratingText)) {
                          return true; // Rating found and is numerical
                      } 
                    }
                    return false;
                  }
                },
                (result) => {

                  if (result[0].result === true) { 
                    // Rating found and numerical, close the tab
                    chrome.tabs.onUpdated.removeListener(tabUpdatedListener);
                    chrome.tabs.remove(tabId);
                    activeTabIds.delete(tabId);
                  } else if (retries < 10) {
                    // Retry after a delay if rating not found or not numerical yet
                    setTimeout(() => checkForRatingAndClose(retries + 1), 1000); // Retry after 1 second
                  }
                }
              );
            }

            // Start checking for rating immediately
            checkForRatingAndClose();
          }
        }
      }
    }
    chrome.tabs.onUpdated.addListener(tabUpdatedListener); // the filter is not yet implemented in chrome, how sad.
  }

  // Wait for all tabs to close
  while (activeTabIds.size > 0) {
    console.log(`activeTabIds: ${activeTabIds.size}`)
    await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 500ms
  }

  console.log("All tabs closed.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getTabId") {
    console.log("Received mail: ", sender.tab.id);
    sendResponse({ tabId: sender.tab.id }); // Send the tab ID back
  }
  return true; // Keep the message channel open for the response
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "reviewAll") {
    console.log("Welcome to Chess.com reviewAll");
    const site = tab.url.split("/")[3];

    var gameLinks;
    // 1. Get all game links from the page
    //   The button for 'Review' has a slightly different class name, whether you are looking at the profile, or games/archive site.
    //   The archive games/archive does not work with a normal querySelectorAll, so it has a system to make sure all the data is loaded before getting the links
    if (site == "member"){
      gameLinks = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: () => {
          // Extract links
          const allLinks = Array.from(document.querySelectorAll('a.archived-games-review'))
                         .map(link => link.href);

          // Remove duplicates using a Set
          return Array.from(new Set(allLinks));
        }
      });

    };
    
    if (site == "games"){
      gameLinks = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const waitForElements = (selector, maxRetries = 10, retryInterval = 500) => {
          return new Promise((resolve, reject) => {
            let retries = 0;
            const checkElements = () => {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                resolve(elements);
              } else if (retries < maxRetries) {
                retries++;
                setTimeout(checkElements, retryInterval);
              } else {
                reject(`Timeout: Elements with selector "${selector}" not found`);
              }
            };
            checkElements();
          });
        };
        
        // Check both main document and potential iframes for review links
        const getReviewLinks = async () => {
          const reviewLinksMain = await waitForElements('a.archive-games-review');
          const iframe = document.querySelector('iframe[id="game-list-iframe"]');
          const reviewLinksIframe = iframe ? iframe.contentDocument.querySelectorAll('a.archive-games-review') : [];
          return [...reviewLinksMain, ...reviewLinksIframe]; 
        };

        return getReviewLinks().then(reviewLinks => {
            return Array.from(reviewLinks).map(link => link.href);
        });
      }
    });
    };


    // Print the game links to the console
    console.log("Extracted Game Links:", gameLinks[0].result);

    await new Promise(resolve => setTimeout(resolve, 500)); 

    reviewAllGames(gameLinks[0].result);
    
  }
})
