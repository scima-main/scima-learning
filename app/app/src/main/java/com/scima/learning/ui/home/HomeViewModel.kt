package com.scima.learning.ui.home

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.asLiveData
import com.scima.learning.model.Deck
import com.scima.learning.repository.DeckRepository

class HomeViewModel(application: Application) : AndroidViewModel(application) {
    private val deckRepository = DeckRepository(application)
    
    val decks: LiveData<List<Deck>> = deckRepository.allDecks.asLiveData()
    
    fun getDeckById(id: Long) = deckRepository.getDeckById(id)
}
