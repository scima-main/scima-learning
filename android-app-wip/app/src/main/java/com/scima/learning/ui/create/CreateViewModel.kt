package com.scima.learning.ui.create

import android.app.Application
import android.os.Parcelable
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.scima.learning.model.Flashcard
import com.scima.learning.repository.AIRepository
import com.scima.learning.repository.SettingsRepository
import kotlinx.coroutines.launch
import android.os.Parcel
import android.os.Parcelable

data class FlashcardPair(
    val front: String,
    val back: String
) : Parcelable {
    constructor(parcel: Parcel) : this(
        parcel.readString() ?: "",
        parcel.readString() ?: ""
    )

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeString(front)
        parcel.writeString(back)
    }

    override fun describeContents(): Int = 0

    companion object CREATOR : Parcelable.Creator<FlashcardPair> {
        override fun createFromParcel(parcel: Parcel): FlashcardPair = FlashcardPair(parcel)
        override fun newArray(size: Int): Array<FlashcardPair?> = arrayOfNulls(size)
    }
}

class CreateViewModel(application: Application) : AndroidViewModel(application) {
    private val settingsRepository = SettingsRepository(application)
    private val aiRepository = AIRepository(settingsRepository)
    
    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading
    
    private val _generatedCards = MutableLiveData<List<FlashcardPair>>()
    val generatedCards: LiveData<List<FlashcardPair>> = _generatedCards
    
    fun generateFlashcardsFromText(text: String) {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                val pairs = aiRepository.generateFlashcardsFromText(text)
                _generatedCards.value = pairs.map { FlashcardPair(it.first, it.second) }
            } catch (e: Exception) {
                e.printStackTrace()
                _generatedCards.value = emptyList()
            } finally {
                _isLoading.value = false
            }
        }
    }
}
